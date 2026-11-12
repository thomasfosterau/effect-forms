/**
 * The reactive Svelte 5 form store.
 *
 * {@link createForm} binds a schema to a reactive, rune-backed {@link FormStore}.
 * Give it either `{ schema, defaults }` (it wraps the core's `Form.make` to seed
 * an empty form) or a server-produced {@link FormState} to hydrate from. The
 * store exposes mutable `data` (bind inputs to it), typed field access
 * through {@link Focus} focuses (`form.field((o) => o.key("name"))`,
 * `form.errorsAt((o) => o.key("name"))`), the plain `errors` tree,
 * `submitting` / `delayed` / `message` / `isValid`, tainted
 * tracking, and a spreadable {@link FormStore.props} for `<form {...form.props}>`
 * that wires progressive-enhancement submission (a Svelte attachment).
 *
 * Submission is handled one of two ways: an `onSubmit` handler the page
 * provides (full client-side / JS handling, with `cancel()` and an optional
 * returned result), or — by default — a POST to the form's action (e.g. a
 * derived SvelteKit action) whose result is applied back to the store.
 *
 * ## Validation engine v2
 *
 * `errors` merges two parallel trees (see {@link Errors.SourcedErrors}):
 * `server` (the last submission's response) and `client` (browser-side
 * validation — the schema, per-field validators, a builder's `refineEffect`
 * refinements). A field's value changing clears *only that field's* server
 * error — a `State.withError` uniqueness failure the user hasn't touched
 * survives a client revalidation of some other field. `clientErrors` /
 * `serverErrors` expose the per-source trees for a UI that wants to style
 * them differently.
 *
 * `validators` (each bound to its field's focus with `Validate.on`) attach
 * per-field sync/async validators (the `FieldValidators` shape — TanStack Form's `onChange(Async)`
 * / `onBlur(Async)` vocabulary). Async validators run as Effect fibers: a new
 * value interrupts the field's in-flight fiber before forking the next run —
 * debounce + "latest wins" cancellation fall out of that alone (see
 * {@link Validate.runAsyncFieldValidator}). `isValidating` /
 * {@link FormStore.isValidatingAt} reflect any fiber still running; supply
 * `layer` when a validator (or a builder's `refineEffect`) needs services.
 *
 * `Mode.RevalidateMode` (`options.mode.revalidate`, default `"onChange"`)
 * governs what happens *after* a failed post in `onSubmit` mode: fixing a
 * field re-validates it (clearing its error) without a resubmit.
 *
 * @copyright Thomas Foster
 * @module effect-forms-svelte/FormStore
 */

// fallow-ignore-file unused-class-member -- `FormStore` / `FieldHandle` members
// are the published store API, read by consumers' Svelte templates and
// scripts; nothing inside this repo is meant to call them.
import {
  Constraints,
  Errors,
  Field,
  Focus,
  Form,
  FormBuilder,
  Issues,
  Mode,
  Path,
  Result,
  State,
  Validate,
} from "@thomasfosterau/effect-forms";
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";
import * as SchemaParser from "effect/SchemaParser";
import { type Attachment, createAttachmentKey } from "svelte/attachments";
import { validateData, validateField } from "./ClientValidate.ts";
import {
  computeDataApplication,
  type FormUpdate,
  isActionResponse,
  objectToFormData,
  parseActionResult,
  resultToUpdate,
} from "./EnhanceCore.ts";
import { dispatchChange, type FieldListener, type FormListeners } from "./Listeners.ts";
import {
  computeTainted,
  isAnyTainted,
  isTaintedAt,
  taintedLeafPaths,
  type TaintedFields,
} from "./Tainted.ts";

// Terse local aliases onto the namespaced core exports (the public API is
// `import { Form, State, … } from "@thomasfosterau/effect-forms"`).
type FormActionResult<A, Message = unknown> = Result.FormActionResult<A, Message>;
type FormErrors = Errors.FormErrors;
type FormPath = Issues.FormPath;
type FormIssue = Issues.FormIssue;
type FormState<A, Message = unknown> = State.FormState<A, Message>;
type InputConstraint = Constraints.InputConstraint;
type InputConstraints = Constraints.InputConstraints;
type LeafFormatter = Issues.LeafFormatter;
/** How a form validates (and optionally auto-submits, and revalidates after a post) as the user types. */
export type FormMode = Mode.FormMode;
/** A field's sync / async validators — see {@link module:effect-forms/Validate}. */
export type FieldValidators<A, R = never> = Validate.FieldValidators<A, R>;
const { clearSourceAt, emptySourced, hasErrors, mergeSourced, noErrors, replaceAt, setSourceAt } =
  Errors;
const { getAt } = Path;
const makeForm = Form.make;

/** `T` with its `readonly` modifiers dropped, for building an options object field by field. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * A builder's `refineEffect` refinements as a whole-form client-side
 * validator: decode the live form data, run the refinements on the decoded
 * values, and answer their issues (none while the data doesn't decode).
 */
export type FormRefinements<R> = (
  data: Path.FormValue,
) => Effect.Effect<ReadonlyArray<FormIssue>, never, R>;

/**
 * The {@link FormRefinements} of `builder`, or `None` when it has no
 * `refineEffect` refinements. The refinements are typed against the builder's
 * *decoded* values, and the server (`Form.fromBuilder`) runs them on decoded
 * data, so the live (encoded) form data is decoded first; data that doesn't
 * decode runs no refinements, exactly as on the server.
 */
export function refinementsOf<F extends FormFields, RefineR>(
  builder: FormBuilder.FormBuilder<F, RefineR>,
): Option.Option<FormRefinements<RefineR>> {
  if (Arr.isReadonlyArrayEmpty(FormBuilder.asyncRefinements(builder))) return Option.none();
  const decode = SchemaParser.decodeUnknownEffect(FormBuilder.buildSchema(builder), {
    errors: "all",
  });
  return Option.some((data) =>
    decode(data).pipe(
      Effect.matchEffect({
        onFailure: (): Effect.Effect<ReadonlyArray<FormIssue>, never, RefineR> =>
          Effect.succeed([]),
        onSuccess: (values) => FormBuilder.runAsyncRefinements(builder, values),
      }),
    ),
  );
}

/**
 * Where a store method reads or writes: a {@link Focus} into the store's data
 * `A`, or a function building one from the store's {@link FormStore.root}
 * (`(o) => o.key("author").key("name")`).
 */
export type At<A, V> = Focus.Focus<A, V> | ((root: Focus.Lens<A, A>) => Focus.Focus<A, V>);

/** An {@link At} that always finds its value: a {@link Focus.Lens}, or a function building one. */
export type LensAt<A, V> = Focus.Lens<A, V> | ((root: Focus.Lens<A, A>) => Focus.Lens<A, V>);

/** Resolve an {@link At} (or {@link LensAt}) against `root`. */
function resolveAt<A, V>(at: LensAt<A, V>, root: Focus.Lens<A, A>): Focus.Lens<A, V>;
function resolveAt<A, V>(at: At<A, V>, root: Focus.Lens<A, A>): Focus.Focus<A, V>;
function resolveAt<A, V>(at: At<A, V>, root: Focus.Lens<A, A>): Focus.Focus<A, V> {
  return P.isFunction(at) ? at(root) : at;
}

/** Per-field state exposed on a {@link FieldHandle}, mirroring TanStack Form's field meta. */
export interface FieldMeta {
  /** Changed at some point, or blurred (TanStack: `isTouched = isDirty || isBlurred`). */
  readonly isTouched: boolean;
  /** Has lost focus at least once — distinct from {@link isTouched}. */
  readonly isBlurred: boolean;
  /**
   * Was changed away from its default value at some point, via `field.value =
   * …` (or another {@link FormStore} write method). Persistent: unlike {@link
   * isDefaultValue}, this does not flip back to `false` if the value is later
   * reverted to the default — only {@link FormStore.reset} clears it.
   */
  readonly isDirty: boolean;
  /** Whether the current value is (still, or again) equal to the field's default. */
  readonly isDefaultValue: boolean;
}

/**
 * The slice of a {@link FormStore} over data `A` a {@link FieldHandle} reads
 * and writes through. Independent of the store's other type parameters, so
 * every `FormStore` over `A` is one as it stands.
 */
export type FieldHost<A extends Path.FormValue> = Pick<
  FormStore<Validate.ServiceFreeSchema, A>,
  | "get"
  | "set"
  | "errorsAt"
  | "visibleErrorsAt"
  | "constraintAt"
  | "isTouchedAt"
  | "isDirtyAt"
  | "isDefaultValueAt"
  | "handleBlur"
>;

/**
 * A typed, reactive handle to one field, returned by {@link FormStore.field}.
 * Bundles everything a single input needs — `bind:value={field.value}`,
 * `name={field.name}`, `onblur={field.handleBlur}`, `{...field.constraints}`,
 * `field.visibleErrors`, `field.meta` — instead of wiring each by hand. The
 * field is named by a {@link Focus.Lens} into the store's data `A`, so
 * `value` is the field's own type `V`.
 */
export class FieldHandle<A extends Path.FormValue, V> {
  readonly #store: FieldHost<A>;
  readonly #focus: Focus.Lens<A, V>;
  /** The path in flat field-name notation — use as the input's `name` attribute. */
  readonly name: string;

  /** A handle on `focus` in `store`; {@link FormStore.field} builds these. */
  constructor(store: FieldHost<A>, focus: Focus.Lens<A, V>) {
    this.#store = store;
    this.#focus = focus;
    this.name = Focus.name(focus);
  }

  /** The field's current value. Assignable — `bind:value={field.value}` works. */
  get value(): V {
    return this.#store.get(this.#focus);
  }

  set value(next: V) {
    this.#store.set(this.#focus, next);
  }

  /** All messages currently attached to this field. */
  get errors(): readonly string[] {
    return this.#store.errorsAt(this.#focus);
  }

  /** This field's messages, gated by the form's validation mode (see {@link FormStore.shouldShowError}). */
  get visibleErrors(): readonly string[] {
    return this.#store.visibleErrorsAt(this.#focus);
  }

  /** Native validation attributes for this field — spread onto the `<input>`. */
  get constraints(): InputConstraint {
    return this.#store.constraintAt(this.#focus);
  }

  /** This field's {@link FieldMeta}. */
  get meta(): FieldMeta {
    const isBlurred = this.#store.isTouchedAt(this.#focus);
    const isDirty = this.#store.isDirtyAt(this.#focus);
    return {
      isTouched: isBlurred || isDirty,
      isBlurred,
      isDirty,
      isDefaultValue: this.#store.isDefaultValueAt(this.#focus),
    };
  }

  /** Mark this field blurred — see {@link FormStore.handleBlur}. */
  handleBlur = (): void => {
    this.#store.handleBlur(this.#focus);
  };
}

/** Transport: turn a submission into a {@link FormActionResult}. Defaults to `fetch`. */
export type SubmitFn<A, Message> = (
  body: FormData,
  action: string,
  form: HTMLFormElement,
) => Promise<FormActionResult<A, Message>>;

/** The submission passed to an {@link FormOptions.onSubmit} handler. */
export interface Submission<A, Message> {
  /** The current (reactive) form data. */
  readonly data: A;
  /** The multipart body that would be posted. */
  readonly formData: FormData;
  /** The form element being submitted. */
  readonly form: HTMLFormElement;
  /**
   * The submit button that triggered this submission (its `name`/`value` is
   * already folded into {@link Submission.formData}, matching native
   * `new FormData(form, submitter)` semantics), or `Option.none()` for an
   * auto-submit (no button was clicked).
   */
  readonly submitter: Option.Option<HTMLElement>;
  /** Abort the submission entirely (no network request, no result applied). */
  readonly cancel: () => void;
  /**
   * Resolve the submission with a result computed in JS (e.g. via an API
   * client), instead of letting the default network POST run. The result is
   * applied to the store exactly as a server response would be.
   */
  readonly resolve: (result: FormActionResult<A, Message>) => void;
}

/** Options for {@link createForm}. */
export interface FormOptions<S extends Validate.ServiceFreeSchema, A, Message, R = never> {
  /** The schema to validate against in the browser (defaults to the bound schema). */
  readonly schema?: S;
  /**
   * When the form validates as the user types (and whether it auto-submits) —
   * see {@link module:effect-forms/Mode}. Defaults to `onSubmit`. `onChange` /
   * `onBlur` auto-validate the form; use {@link FormStore.shouldShowError} /
   * {@link FormStore.visibleErrorsAt} to gate display per field.
   */
  readonly mode?: FormMode;
  /**
   * The builder's field record, set automatically when {@link createForm} is
   * given a {@link FormBuilder}. A fallback for deriving a blank array item
   * when no `schema` is bound — with a schema, {@link FormStore.append} /
   * {@link FormStore.insertItem} resolve the item (at any nesting depth) by
   * walking the schema's AST instead.
   */
  readonly fields?: Field.FieldsRecord;
  /**
   * A whole-form async validator, set automatically when {@link createForm} is
   * given a {@link FormBuilder} with `refineEffect` refinements: it decodes the
   * form data through the builder's schema (as on the server) and runs the
   * refinements on the decoded values, whenever {@link FormStore.validate}
   * runs. While the data doesn't decode it reports no issues, and the field
   * errors say why. See {@link refinementsOf}.
   */
  readonly refinements?: FormRefinements<R>;
  /** The action URL the form posts to (defaults to the current page's action). */
  readonly action?: string;
  /** Reset `data` back to the initial values after a successful submit. */
  readonly resetForm?: boolean;
  /** Warn (via `beforeunload`) when navigating away with unsaved changes. */
  readonly taintedMessage?: string | false;
  /** Milliseconds before an in-flight submission flips `delayed` to `true`. */
  readonly delayMs?: number;
  /** Override the message rendering used by client-side validation. */
  readonly validationFormat?: LeafFormatter;
  /** Override how a submission is sent (default: `fetch` to the form's action). */
  readonly submit?: SubmitFn<A, Message>;
  /**
   * Per-field sync/async validators, each bound to its field's focus with
   * `Validate.on`, built from the store's root focus:
   * `validators: (o) => [Validate.on(o.key("username"), { onChange: … })]`.
   * A validator receives the field's value as the focus types it. See
   * {@link FormStore.setFieldValidators} to register one dynamically instead
   * (e.g. once an array item exists).
   */
  readonly validators?: (
    root: Focus.Lens<A, A>,
  ) => ReadonlyArray<Validate.BoundFieldValidators<A, R>>;
  /**
   * Services an async field validator or a builder's `refineEffect`
   * refinement needs on its `R` channel. A `ManagedRuntime` is built from
   * this once per store and reused for every client-side Effect run. Required
   * exactly when `R` is not `never` (see {@link createForm}'s overloads).
   */
  readonly layer?: Layer.Layer<R>;
  /**
   * Handle the submission entirely in JS: given the current data, return the
   * {@link FormActionResult} to apply (e.g. by calling an API client). When set,
   * this runs instead of the network POST — the "handled using JS on the page"
   * path. `onSubmit`'s `cancel()` / `resolve()` still take precedence.
   */
  readonly handler?: (
    data: A,
  ) => FormActionResult<A, Message> | Promise<FormActionResult<A, Message>>;
  /**
   * Handle the submission in JS on the page. Receives the data + form, can
   * `cancel()` it or `resolve(result)` it directly; if it neither cancels nor
   * resolves, the default network POST runs.
   */
  readonly onSubmit?: (input: Submission<A, Message>) => void | Promise<void>;
  /** Called with the raw {@link FormActionResult} once the response is parsed. */
  readonly onResult?: (input: { readonly result: FormActionResult<A, Message> }) => void;
  /** Called with the computed {@link FormUpdate} before it is applied. */
  readonly onUpdate?: (input: {
    readonly update: FormUpdate<A, Message>;
    readonly result: FormActionResult<A, Message>;
  }) => void;
  /** Called after the update has been applied to the store. */
  readonly onUpdated?: (input: {
    readonly form: { readonly data: A; readonly errors: FormErrors; readonly isValid: boolean };
  }) => void;
  /** Called on an unexpected (non-user-fixable) error. */
  readonly onError?: (input: { readonly error: string }) => void;
  /** Called on a redirect result (default: `window.location.assign`). */
  readonly onRedirect?: (input: { readonly location: string }) => void;
  /**
   * Field- and form-level listeners (onMount / onChange / onBlur) — see
   * {@link module:effect-forms-svelte/Listeners}. Fire independent of
   * `mode`'s validation, and tear down with {@link FormStore.enhance}'s
   * `destroy`.
   */
  readonly listeners?: FormListeners;
}

/** The options a {@link FormStore} is constructed with: {@link FormOptions} with its `layer` supplied. */
export type StoreOptions<S extends Validate.ServiceFreeSchema, A, Message, R = never> = FormOptions<
  S,
  A,
  Message,
  R
> & { readonly layer: Layer.Layer<R> };

/**
 * A submission that produced no result: the `handler` / `submit` threw or
 * rejected, applying the result threw, or the default POST never got a
 * response. `message` is what `onError` reports.
 */
class SubmissionFailed extends Schema.TaggedError<
  SubmissionFailed,
  { readonly brand: unique symbol }
>()("SubmissionFailed", { message: Schema.String }) {}

/** Wrap whatever a submission step threw: an `Error` keeps its message. */
const submissionFailed = (cause: unknown): SubmissionFailed =>
  new SubmissionFailed({ message: P.isError(cause) ? cause.message : "Submission failed" });

/**
 * The default submission: POST `body` to `action` with `Accept:
 * application/json` through Effect's `HttpClient` on the platform `fetch`,
 * and read the response as a {@link FormActionResult}. A body that isn't a
 * recognised action response becomes an `Error` result carrying the status;
 * only a transport failure fails the Effect, with the rejection `fetch`
 * itself raised (its `TypeError`, say) rather than the client's wrapper.
 */
const defaultSubmit = <A, Message>(
  body: FormData,
  action: string,
): Effect.Effect<FormActionResult<A, Message>, SubmissionFailed, HttpClient.HttpClient> =>
  HttpClient.execute(
    HttpClientRequest.post(action).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.bodyFormData(body),
    ),
  ).pipe(
    Effect.flatMap((response) =>
      Effect.match(response.json, {
        onSuccess: (parsed): FormActionResult<A, Message> =>
          isActionResponse<A, Message>(parsed)
            ? parseActionResult(parsed, response.status)
            : { _tag: "Error", status: response.status, message: "Unrecognised form response" },
        onFailure: (): FormActionResult<A, Message> => ({
          _tag: "Error",
          status: response.status,
          message: "Request failed",
        }),
      }),
    ),
    Effect.mapError((error) =>
      submissionFailed(
        P.isTagged(error.reason, "TransportError") ? (error.reason.cause ?? error) : error,
      ),
    ),
    // The `fetch` in place at submit time, as a direct call would use (the
    // layer's default captures the first one it sees), and no `b3` /
    // `traceparent` headers: they would make a cross-origin action preflight.
    Effect.provideService(FetchHttpClient.Fetch, globalThis.fetch),
    Effect.provideService(HttpClient.TracerPropagationEnabled, false),
  );

/** Whether `index` is a valid position in an array of `length`. */
const inRange = (index: number, length: number): boolean => index >= 0 && index < length;

/** A field trigger a validator or the revalidate mode reacts to. */
type FieldTrigger = "change" | "blur";

/**
 * The spreadable `<form>` attributes {@link FormStore.props} answers: the
 * `post` method, the configured `action` (when one is set), and the
 * progressive-enhancement submit handler under a Svelte attachment key.
 */
export interface FormProps {
  readonly method: "post";
  readonly action?: string;
  readonly [attachmentKey: symbol]: Attachment<HTMLFormElement>;
}

/** A reactive form, returned by {@link createForm}. */
export class FormStore<
  S extends Validate.ServiceFreeSchema,
  A extends Path.FormValue,
  Message = unknown,
  R = never,
> {
  /** The reactive form data — bind inputs to its fields. */
  data: A;
  /** The current status message, if any. */
  message: Message | undefined = $state();
  /** Native input constraints derived server-side. */
  constraints: InputConstraints = $state({});
  /** Whether a submission is in flight. */
  submitting = $state(false);
  /** Whether the in-flight submission has passed `delayMs`. */
  delayed = $state(false);
  /** Whether the current state came from a submission. */
  isPosted = $state(false);
  /** Whether the last validation/submit was valid. */
  isValid = $state(false);
  /** How many times {@link FormStore.enhance}'s submit handler has actually attempted a submission. */
  submissionAttempts = $state(0);

  /**
   * The values sent by the last submission (for revert / changed-since-submit).
   * Raw (never proxied): it is only ever replaced wholesale by a detached
   * copy, so reading it yields that plain value.
   */
  #lastSubmitted: Option.Option<A> = $state.raw(Option.none());
  /**
   * Per-field blurred flags, keyed by {@link Path.toString}. Drives `onBlur`
   * display (via {@link shouldShowError}) and {@link FieldMeta.isBlurred}.
   */
  #touched: Partial<Record<string, boolean>> = $state({});
  /**
   * Per-field persistent dirty flags, keyed by {@link Path.toString}. Set once
   * a field's value is changed away from its default via {@link set} or
   * an array mutator (`append` / `removeItem` / `swap` / `move`), and never
   * cleared except by {@link reset} — unlike {@link taintedAt}, a revert to the
   * default value does not clear it. Backs {@link FieldMeta.isDirty}. Only
   * tracks writes made through those methods — mutating `data` directly
   * (`bind:value={form.data.x}`, bypassing {@link FormStore.field}) never marks
   * a field dirty.
   */
  #dirtied: Partial<Record<string, boolean>> = $state({});
  /** Parallel error trees — see {@link Errors.SourcedErrors}. `errors` is their merged view. */
  #sourced: Errors.SourcedErrors = $state(emptySourced);
  /** Whether *any* validation (whole-form or per-field) has run yet — see {@link canSubmit}. */
  #hasValidated = $state(false);
  /** Per-field / whole-form ("") async-validation-in-flight flags, keyed by `"<path>:<trigger>"` or `""`. */
  #validating: Partial<Record<string, boolean>> = $state({});
  /** Per-key run counter guarding `#validating` writes — see {@link FormStore.#runValidatorFiber}. */
  #validatingGeneration: Record<string, number> = {};
  /** The outcome of the last completed submission, for {@link isSubmitSuccessful}. */
  #lastSubmitOutcome: Option.Option<"success" | "failure"> = $state.raw(Option.none());

  readonly id: string;
  /** The tainted baseline `tainted`/`isTainted` compare against — rebased on every successful submit. */
  #initial: A;
  readonly #options: StoreOptions<S, A, Message, R>;
  readonly #mode: Mode.ParsedMode;
  readonly #attachmentKey = createAttachmentKey();
  readonly #runtime: ManagedRuntime.ManagedRuntime<R, never>;
  /**
   * The submission boundary: `HttpClient` on the platform `fetch`, kept apart
   * from {@link FormStore.#runtime} so an `HttpClient` the caller's `layer`
   * gives its validators never redirects the default POST. Built on the first
   * submit.
   */
  readonly #submitRuntime = ManagedRuntime.make(FetchHttpClient.layer);
  #autoSubmitNode: Option.Option<HTMLFormElement> = Option.none();
  #validateTimer: Option.Option<ReturnType<typeof setTimeout>> = Option.none();
  /** Per-field-listener debounce timers, keyed by `"change:<path>"` / `"blur:<path>"`. */
  #listenerTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  /** Per-field validators, keyed by {@link Path.toString} of their path; seeded from `options.validators`. */
  #fieldValidators: Record<string, Validate.BoundFieldValidators<A, R>>;
  /** In-flight async-validator fibers, keyed by `"<path>:<trigger>"` (fields) or `""` (whole-form `refineEffect`). */
  #fibers: Record<string, Fiber.Fiber<unknown>> = {};
  /** The error paths the last `refineEffect` run set, so the next run can clear exactly those before merging fresh ones. */
  #lastRefinementPaths: FormPath[] = [];
  /**
   * The data snapshot the field-tracking watcher last diffed against. Only
   * ever diffed (`computeTainted` takes `unknown`), so typed no tighter.
   */
  #previousData: unknown;

  /** The runtime error tree behind {@link errors}: server errors merged with client errors. */
  readonly #mergedErrors: FormErrors = $derived(mergeSourced(this.#sourced));
  /**
   * The current nested error tree (server errors merged with client errors),
   * as the plain JSON `FormErrors` it is. Read one field's messages with
   * {@link errorsAt}, and the form-level ones with {@link formErrors}.
   */
  readonly errors: FormErrors = $derived(this.#mergedErrors);
  /** Client-side-sourced errors only (schema, per-field validators, `refineEffect`). */
  readonly clientErrors: FormErrors = $derived(this.#sourced.client);
  /** Server-sourced errors only (the last submission's response). */
  readonly serverErrors: FormErrors = $derived(this.#sourced.server);
  /**
   * The form-level messages: the ones attached to the form as a whole (the
   * error tree's root `_errors` — a 409, a rejected command, a cross-field
   * refinement on the root).
   */
  readonly formErrors: readonly string[] = $derived(
    Option.getOrElse(Errors.getError(this.#mergedErrors, []), () => []),
  );
  /** Whether any async field validator or `refineEffect` run is currently in flight. */
  readonly isValidating: boolean = $derived(Arr.some(R.values(this.#validating), Boolean));
  /** Whether the form has ever been submitted (attempted). */
  readonly isSubmitted: boolean = $derived(this.submissionAttempts > 0);
  /** Whether the most recently *completed* submission succeeded. `false` before any submit completes. */
  readonly isSubmitSuccessful: boolean = $derived(
    Option.contains(this.#lastSubmitOutcome, "success"),
  );
  /**
   * Whether the submit button should be enabled: not mid-submit, not
   * mid-validation, and either nothing has been validated yet (a pristine
   * form isn't presumptively invalid — the server gets the first look) or the
   * last validation run said valid.
   */
  readonly canSubmit: boolean = $derived(
    !this.submitting && !this.isValidating && (!this.#hasValidated || this.isValid),
  );

  /** The tainted-field tree, re-derived as `data` changes. */
  readonly tainted: TaintedFields = $derived.by(() => computeTainted(this.#initial, this.data));
  /** Whether any field has been changed since the form was seeded. */
  readonly isTainted: boolean = $derived(isAnyTainted(this.tainted));
  /** The tree of fields changed since the last submission (empty before any submit). */
  readonly changedSinceSubmit: TaintedFields = $derived.by(() =>
    Option.match(this.#lastSubmitted, {
      onNone: () => ({}),
      onSome: (lastSubmitted) => computeTainted(lastSubmitted, this.data),
    }),
  );
  /** Whether anything has changed since the last submission. */
  readonly hasChangedSinceSubmit: boolean = $derived(isAnyTainted(this.changedSinceSubmit));

  /**
   * Hydrate a store from `initial`. `options.layer` provides the services
   * `R` its validators and refinements need; {@link createForm} supplies
   * `Layer.empty` when `R` is `never`.
   */
  constructor(initial: FormState<A, Message>, options: StoreOptions<S, A, Message, R>) {
    this.data = $state(structuredClone(initial.data));
    this.id = initial.id;
    this.#initial = structuredClone(initial.data);
    this.#previousData = structuredClone(initial.data);
    this.#options = options;
    this.#mode = Mode.parse(options.mode);
    this.#runtime = ManagedRuntime.make(options.layer);
    this.#fieldValidators = R.fromEntries(
      Arr.map(options.validators?.(this.root) ?? [], (bound) => [Path.toString(bound.path), bound]),
    );
    this.#sourced = { client: noErrors, server: initial.errors ?? noErrors };
    this.message = initial.message;
    // The `{ schema, defaults }` overload always arrives with `constraints`
    // already derived (via the core's `Form.make`); the `FormState`-hydration
    // overload's caller may not have supplied any, so derive from
    // `options.schema` here too — the two overloads must be symmetric.
    this.constraints =
      initial.constraints ??
      (options.schema ? Constraints.constraintsFromSchema(options.schema) : {});
    this.isPosted = initial.isPosted;
    this.isValid = initial.isValid;
    // `canSubmit` treats "never validated" as presumptively valid (a pristine
    // form isn't guilty until proven so); hydrating from a `isPosted` state
    // means something already *has* judged it, so `isValid` must be trusted
    // from the start — otherwise a server-rejected `FormState` briefly (or
    // permanently, if nothing re-triggers validation) reports `canSubmit: true`.
    this.#hasValidated = initial.isPosted;
  }

  /**
   * Spreadable attributes for the `<form>` element: `<form {...form.props}>`.
   * Sets `method="post"` (and `action`, if configured) and attaches the
   * progressive-enhancement submit handler via a Svelte attachment.
   */
  get props(): FormProps {
    const action = this.#options.action;
    return action === undefined
      ? { method: "post", [this.#attachmentKey]: this.#enhanceAttachment }
      : { method: "post", action, [this.#attachmentKey]: this.#enhanceAttachment };
  }

  /**
   * The focus on the whole of the form's data: the root every other focus is
   * built from (`form.root.key("author").key("name")`). A store method also
   * accepts a function of it (`(o) => o.key("author")`).
   */
  readonly root: Focus.Lens<A, A> = Focus.root<A>();

  /** The path an {@link At} names. */
  #pathOf<V>(at: At<A, V>): FormPath {
    return resolveAt(at, this.root).path;
  }

  /** Whether the field `at` names (or anything beneath it) is tainted. */
  taintedAt<V>(at: At<A, V>): boolean {
    return isTaintedAt(this.tainted, this.#pathOf(at));
  }

  /** The messages attached directly to the field `at` names (an array's or a branch's own messages for one). */
  errorsAt<V>(at: At<A, V>): readonly string[] {
    return this.#errorsAtPath(this.#pathOf(at));
  }

  /** The messages attached directly to `path` in the merged tree. */
  #errorsAtPath(path: FormPath): readonly string[] {
    return Option.getOrElse(Errors.getError(this.#mergedErrors, path), () => []);
  }

  /**
   * Every message at or beneath the field `at` names, with paths relative to
   * it — for a "something in this section is wrong" summary.
   */
  errorsUnder<V>(at: At<A, V>): ReadonlyArray<FormIssue> {
    return Errors.issuesUnder(this.#mergedErrors, this.#pathOf(at));
  }

  /** Whether any message sits at or beneath the field `at` names. */
  hasErrorsAt<V>(at: At<A, V>): boolean {
    return Arr.isReadonlyArrayNonEmpty(this.errorsUnder(at));
  }

  /** Whether the async validator(s) of the field `at` names are currently running. */
  isValidatingAt<V>(at: At<A, V>): boolean {
    const key = Path.toString(this.#pathOf(at));
    return this.#validating[`${key}:change`] === true || this.#validating[`${key}:blur`] === true;
  }

  /**
   * Register (or replace) the validators of the field `at` names — the
   * dynamic equivalent of `options.validators`, for fields that don't exist
   * until later (e.g. an appended array item). Each validator receives the
   * field's value as the focus types it.
   */
  setFieldValidators<V>(at: At<A, V>, validators: FieldValidators<NoInfer<V>, R>): void {
    const bound = Validate.on(resolveAt(at, this.root), validators);
    this.#fieldValidators = { ...this.#fieldValidators, [Path.toString(bound.path)]: bound };
  }

  /** Re-validate the whole form against the schema (if one was supplied), plus a builder's `refineEffect` refinements. */
  validate(): boolean {
    if (this.#options.schema) {
      const clientErrors = validateData(
        this.#options.schema,
        this.data,
        this.#options.validationFormat,
      );
      this.#sourced = { ...this.#sourced, client: clientErrors };
      this.#hasValidated = true;
      this.#recomputeValid();
    }
    this.#runRefineEffect();
    return this.isValid;
  }

  /** Validate the field `at` names against the schema, returning that field's messages. */
  validateField<V>(at: At<A, V>): readonly string[] {
    return this.#validateFieldAt(this.#pathOf(at));
  }

  /** {@link validateField} at a runtime path. */
  #validateFieldAt(path: FormPath): readonly string[] {
    if (!this.#options.schema) return this.#errorsAtPath(path);
    return validateField(this.#options.schema, this.data, path, this.#options.validationFormat);
  }

  /** The value of the field the lens `at` names. */
  get<V>(at: LensAt<A, V>): V {
    return resolveAt(at, this.root).get(this.data);
  }

  /** The value of the field `at` names, or `None` where its focus finds nothing. */
  getOption<V>(at: At<A, V>): Option.Option<V> {
    return resolveAt(at, this.root).getOption(this.data);
  }

  /**
   * Set the value of the field `at` names (immutably; a focus that finds
   * nothing leaves the data unchanged), marking it dirty and running its
   * change validators. Bind directly to `data` otherwise.
   */
  set<V>(at: At<A, V>, value: NoInfer<V>): void {
    const focus = resolveAt(at, this.root);
    this.data = focus.replace(value, this.data);
    this.#afterWrite(focus.path);
  }

  /** The bookkeeping after a write at `path`: dirty flag, field-change snapshot, change validators. */
  #afterWrite(path: FormPath): void {
    this.#markDirty(path);
    this.#previousData = this.#detachedData();
    this.#onFieldChanged(path);
  }

  /** Mark the field `at` names touched (defaults to `true`) — drives `onBlur` display. */
  setTouched<V>(at: At<A, V>, touched = true): void {
    this.#setTouchedAt(this.#pathOf(at), touched);
  }

  #setTouchedAt(path: FormPath, touched: boolean): void {
    this.#touched = { ...this.#touched, [Path.toString(path)]: touched };
  }

  /** Whether the field `at` names has been touched (blurred). */
  isTouchedAt<V>(at: At<A, V>): boolean {
    return this.#isTouchedAtPath(this.#pathOf(at));
  }

  #isTouchedAtPath(path: FormPath): boolean {
    return this.#touched[Path.toString(path)] === true;
  }

  /**
   * Once a change away from the default at `path` is seen (per the current
   * `data`, against the tainted tree), sticks until {@link reset}. Called after
   * `data` has already been updated, by every method that writes it
   * (`set` and the array mutators below) — writing `data` directly
   * (`bind:value={form.data.x}`) bypasses this, same as it bypasses `tainted`
   * recomputing off anything but `data` itself would.
   */
  #markDirty(path: FormPath): void {
    const key = Path.toString(path);
    if (!this.#dirtied[key] && isTaintedAt(this.tainted, path)) {
      this.#dirtied = { ...this.#dirtied, [key]: true };
    }
  }

  /** Whether the field `at` names was ever changed away from its default — see {@link FieldMeta.isDirty}. */
  isDirtyAt<V>(at: At<A, V>): boolean {
    return this.#dirtied[Path.toString(this.#pathOf(at))] === true;
  }

  /** Whether the field `at` names currently holds its default value — the negation of {@link taintedAt}. */
  isDefaultValueAt<V>(at: At<A, V>): boolean {
    return !this.taintedAt(at);
  }

  /** The native validation attributes of the field `at` names (a leaf of {@link constraints}). */
  constraintAt<V>(at: At<A, V>): InputConstraint {
    return Constraints.constraintAt(this.constraints, this.#pathOf(at));
  }

  /**
   * A typed, reactive handle to the field the lens `at` names — see
   * {@link FieldHandle}. For an array item, give the item's optional focus a
   * fallback: `form.field((o) => o.key("tags").at(i).orElse(""))`.
   */
  field<V>(at: LensAt<A, V>): FieldHandle<A, V> {
    return new FieldHandle(this, resolveAt(at, this.root));
  }

  /**
   * Handle the field `at` names losing focus: mark it touched, run its
   * `onBlur` / `onBlurAsync` validators (or, once posted, the
   * revalidate-on-blur mode), fire that field's `onBlur` listener (if any,
   * debounced per its config), and — in `onBlur` validation mode — validate
   * the whole form (auto-submitting if configured and something changed since
   * the last submit).
   */
  handleBlur<V>(at: At<A, V>): void {
    const path = this.#pathOf(at);
    this.#setTouchedAt(path, true);
    this.#onFieldBlurred(path);
    const key = Path.toString(path);
    const field = this.#options.listeners?.fields?.[key];
    if (field?.onBlur) {
      // Capture the value at blur time, not at timer-fire time — otherwise a
      // debounced listener would report whatever the field holds *now*, not
      // what it held when it was blurred.
      const value = getAt(this.data, path);
      this.#scheduleListener(`blur:${key}`, () => field.onBlur?.({ path, value }), field.debounce);
    }
    if (this.#mode.validation === "onBlur") {
      this.validate();
      if (this.#mode.autoSubmit && this.isValid && this.#hasUnsubmittedChanges())
        this.#autoSubmit();
    }
  }

  /** Run `run` now, or after `debounce` (per-key timer, replacing any pending run for that key). */
  #scheduleListener(key: string, run: () => void, debounce?: Duration.Input): void {
    if (debounce === undefined) {
      run();
      return;
    }
    clearTimeout(this.#listenerTimers[key]);
    this.#listenerTimers[key] = setTimeout(() => {
      delete this.#listenerTimers[key];
      run();
    }, Duration.toMillis(debounce));
  }

  /**
   * The listeners table to dispatch change events against, with each field's
   * `onChange` wrapped in this store's own debounce timer — or `None` if
   * nothing is configured to consume a change (an `onMount`-only config, say),
   * so the deep watcher can skip diffing the data tree entirely. Built once
   * per {@link enhance} call rather than per change, since the listener table
   * itself doesn't change across the mount's lifetime.
   */
  #buildDispatchListeners(): Option.Option<FormListeners> {
    const listeners = this.#options.listeners;
    if (!listeners || (listeners.onChange === undefined && !listeners.fields)) {
      return Option.none();
    }
    if (!listeners.fields) return Option.some(listeners);
    const fields = R.fromEntries(
      Arr.map(R.toEntries(listeners.fields), ([key, field]): [string, FieldListener] => [
        key,
        field.onChange
          ? {
              ...field,
              onChange: (input) =>
                this.#scheduleListener(
                  `change:${key}`,
                  () => field.onChange?.(input),
                  field.debounce,
                ),
            }
          : field,
      ]),
    );
    return Option.some({ ...listeners, fields });
  }

  /**
   * Whether there are edits worth auto-submitting: before any submit, any
   * change from the seeded values; afterwards, any change since the last
   * submission. Stops `autoSubmit` from re-posting server-echoed data in a loop.
   */
  #hasUnsubmittedChanges(): boolean {
    return Option.isNone(this.#lastSubmitted) ? this.isTainted : this.hasChangedSinceSubmit;
  }

  /**
   * Whether an error on the field `at` names should be shown yet, per the
   * validation mode: always after a submit; in `onChange` once the field is
   * tainted; in `onBlur` once it is touched; never in `onSubmit` before
   * posting.
   */
  shouldShowError<V>(at: At<A, V>): boolean {
    if (this.isPosted) return true;
    if (this.#mode.validation === "onChange") return this.taintedAt(at);
    if (this.#mode.validation === "onBlur") return this.isTouchedAt(at);
    return false;
  }

  /** The messages on the field `at` names, but only when {@link shouldShowError} allows it. */
  visibleErrorsAt<V>(at: At<A, V>): readonly string[] {
    return this.shouldShowError(at) ? this.errorsAt(at) : [];
  }

  /**
   * The schema-derived blank item for the array `at` names (any nesting
   * depth, e.g. `authors[0].emails`): what a new row starts as. Typed as the
   * {@link Field.BlankValue} it is — a blank need not be a valid item — so it
   * can be passed to {@link append} / {@link insertItem} exactly where the
   * array's items admit it (a {@link DraftData} array of `FormValue`s).
   */
  blankItemAt<E>(at: At<A, ReadonlyArray<E>>): Field.BlankValue {
    return this.#defaultItem(this.#pathOf(at));
  }

  /** Write `next` (computed from the current array) to the array `focus` names, then the write bookkeeping. */
  #writeArray<E>(
    focus: Focus.Focus<A, ReadonlyArray<E>>,
    next: (current: ReadonlyArray<E>) => ReadonlyArray<E>,
  ): void {
    this.data = focus.modify(next)(this.data);
    this.#markDirty(focus.path);
  }

  /** The array `focus` names (empty when it finds none). */
  #arrayAt<E>(focus: Focus.Focus<A, ReadonlyArray<E>>): ReadonlyArray<E> {
    return Option.getOrElse(focus.getOption(this.data), (): ReadonlyArray<E> => []);
  }

  /** Append `value` to the array `at` names (see {@link blankItemAt} for a schema-derived blank). */
  append<E>(at: At<A, ReadonlyArray<E>>, value: NoInfer<E>): void {
    const focus = resolveAt(at, this.root);
    this.#writeArray(focus, (current) => [...current, value]);
    this.#previousData = this.#detachedData();
    this.#onFieldChanged(focus.path);
  }

  /**
   * Insert `value` into the array `at` names at `index` (clamped to the
   * array's bounds; a non-finite `index` inserts at the end), shifting later
   * items — and their per-index touched flags / errors — up by one.
   */
  insertItem<E>(at: At<A, ReadonlyArray<E>>, index: number, value: NoInfer<E>): void {
    const focus = resolveAt(at, this.root);
    const length = this.#arrayAt(focus).length;
    const position = Math.max(0, Math.min(Number.isFinite(index) ? index : length, length));
    this.#writeArray(focus, (current) => [
      ...current.slice(0, position),
      value,
      ...current.slice(position),
    ]);
    this.#remapArrayIndices(focus.path, Path.insertAt(position));
  }

  /**
   * Replace the item at `index` in the array `at` names, in place. Drops that
   * index's own touched flag / errors (they described the old value); other
   * indices are untouched.
   */
  replaceItem<E>(at: At<A, ReadonlyArray<E>>, index: number, value: NoInfer<E>): void {
    const focus = resolveAt(at, this.root);
    if (!inRange(index, this.#arrayAt(focus).length)) return;
    this.#writeArray(focus, (current) => current.map((item, i) => (i === index ? value : item)));
    this.#remapArrayIndices(focus.path, Path.replaceAt(index));
  }

  /** Remove every item from the array `at` names, dropping all of its per-index state. */
  clearItems<E>(at: At<A, ReadonlyArray<E>>): void {
    const focus = resolveAt(at, this.root);
    this.#writeArray(focus, (): ReadonlyArray<E> => []);
    this.#remapArrayIndices(focus.path, Path.clearAll);
  }

  /**
   * Remove the item at `index` from the array `at` names, shifting later
   * items' per-index touched flags / errors down by one so they keep
   * following their row.
   */
  removeItem<E>(at: At<A, ReadonlyArray<E>>, index: number): void {
    const focus = resolveAt(at, this.root);
    if (!inRange(index, this.#arrayAt(focus).length)) return;
    this.#writeArray(focus, (current) => current.filter((_, i) => i !== index));
    this.#remapArrayIndices(focus.path, Path.removeAt(index));
    this.#previousData = this.#detachedData();
    this.#onFieldChanged(focus.path);
  }

  /** Swap two items in the array `at` names, swapping their per-index touched flags / errors too. */
  swap<E>(at: At<A, ReadonlyArray<E>>, indexA: number, indexB: number): void {
    const focus = resolveAt(at, this.root);
    const length = this.#arrayAt(focus).length;
    if (!inRange(indexA, length) || !inRange(indexB, length) || indexA === indexB) return;
    this.#writeArray(focus, (current) =>
      current.map((item, i) =>
        i === indexA ? current[indexB] : i === indexB ? current[indexA] : item,
      ),
    );
    this.#remapArrayIndices(focus.path, Path.swapAt(indexA, indexB));
    this.#previousData = this.#detachedData();
    this.#onFieldChanged(focus.path);
  }

  /** Move the item at `from` to `to` within the array `at` names, carrying its per-index state along. */
  move<E>(at: At<A, ReadonlyArray<E>>, from: number, to: number): void {
    const focus = resolveAt(at, this.root);
    const length = this.#arrayAt(focus).length;
    if (!inRange(from, length) || to < 0 || to >= length || from === to) return;
    this.#writeArray(focus, (current) => {
      const rest = current.filter((_, i) => i !== from);
      return [...rest.slice(0, to), current[from], ...rest.slice(to)];
    });
    this.#remapArrayIndices(focus.path, Path.moveAt(from, to));
    this.#previousData = this.#detachedData();
    this.#onFieldChanged(focus.path);
  }

  /**
   * Remap the per-index touched flags and errors under the array at `path`
   * through `map`, so state recorded against a row follows it through an
   * index-shifting mutation. See {@link Path.IndexMap}.
   */
  #remapArrayIndices(path: FormPath, map: Path.IndexMap): void {
    const sourced = this.#sourcedSnapshot();
    this.#sourced = {
      client: Errors.remapIndices(sourced.client, path, map),
      server: Errors.remapIndices(sourced.server, path, map),
    };
    this.#touched = Path.remapKeyedRecord(this.#touched, path, map);
  }

  /** Revert `data` to the values sent by the last submission (no-op before any submit). */
  revertToLastSubmit(): void {
    if (Option.isNone(this.#lastSubmitted)) return;
    // `#lastSubmitted` is `$state.raw`, so this is the plain value, which
    // `structuredClone` accepts (a deep-`$state` proxy it would reject).
    this.data = structuredClone(this.#lastSubmitted.value);
    this.#previousData = this.#detachedData();
    this.#sourced = emptySourced;
  }

  /**
   * Derive a blank item for the array field at `path`, at any nesting depth
   * (e.g. `authors[0].emails`) — by walking the bound schema's AST there when
   * one is available, falling back to a top-level {@link FormOptions.fields}
   * lookup, else `""`.
   */
  #defaultItem(path: FormPath): Field.BlankValue {
    if (this.#options.schema) return Field.defaultItemAt(this.#options.schema, path);
    const fields = this.#options.fields;
    if (fields && path.length === 1 && P.isString(path[0])) {
      const def = fields[path[0]];
      if (def && Field.isArrayFieldDef(def)) return Field.defaultValue(def.itemSchema);
    }
    return "";
  }

  /** Submit via the enhanced node, if one is mounted and not already in flight. */
  #autoSubmit(): void {
    if (this.submitting || Option.isNone(this.#autoSubmitNode)) return;
    void this.#runSubmit(this.#autoSubmitNode.value);
  }

  /** Debounced (in `onChange`) whole-form validation, auto-submitting when valid. */
  #scheduleValidation(): void {
    const run = (): void => {
      this.validate();
      if (this.#mode.autoSubmit && this.isValid && this.#hasUnsubmittedChanges())
        this.#autoSubmit();
    };
    const ms = Option.getOrElse(this.#mode.debounce, () => 0);
    if (ms > 0) {
      this.#clearValidateTimer();
      this.#validateTimer = Option.some(setTimeout(run, ms));
    } else {
      run();
    }
  }

  /** Cancel the pending debounced whole-form validation, if any. */
  #clearValidateTimer(): void {
    if (Option.isSome(this.#validateTimer)) clearTimeout(this.#validateTimer.value);
    this.#validateTimer = Option.none();
  }

  #recomputeValid(): void {
    this.isValid = !hasErrors(mergeSourced(this.#sourced));
  }

  /**
   * A plain (non-`$state`-proxy) snapshot of `#sourced`. `clearSourceAt` /
   * `setSourceAt` / `replaceAt` in the framework-neutral core `structuredClone`
   * their `errors` argument — which throws `DataCloneError` on a live Svelte
   * `$state` proxy — so anywhere `#sourced` (or one of its two branches) feeds
   * one of those calls, snapshot it first.
   */
  #sourcedSnapshot(): Errors.SourcedErrors {
    // `$state.snapshot` of that plain tree is a deep copy of the same shape.
    return $state.snapshot(this.#sourced);
  }

  /** Whether {@link Mode.ParsedMode.revalidate} names this field trigger. */
  #revalidatesOn(trigger: FieldTrigger): boolean {
    if (this.#mode.revalidate === "never") return false;
    return this.#mode.revalidate === "onChange" ? trigger === "change" : trigger === "blur";
  }

  /** Interrupt (fire-and-forget) any fiber running under `key`, if one is in flight. */
  #interruptFiber(key: string): void {
    const previous = this.#fibers[key];
    if (previous) this.#runtime.runFork(Fiber.interrupt(previous));
    delete this.#fibers[key];
  }

  /**
   * Fork `effect` under `key` as an interrupt-on-supersede fiber, toggling
   * `#validating[key]` for its duration: any fiber already running under
   * `key` is interrupted first (this — not a timer — is what gives "latest
   * wins"; see {@link Validate.runAsyncFieldValidator}). The old and new
   * fiber's `#validating` writes are guarded by a per-key generation counter
   * — the interrupt {@link FormStore.#interruptFiber} forks is fire-and-forget, so the
   * *old* fiber's `Effect.ensuring` finalizer can run after the *new* one has
   * already flipped `#validating[key]` back to `true`; without the guard that
   * finalizer would clear it while the new run is still genuinely in flight.
   */
  #runValidatorFiber(key: string, effect: Effect.Effect<unknown, never, R>): void {
    this.#interruptFiber(key);
    const generation = (this.#validatingGeneration[key] ?? 0) + 1;
    this.#validatingGeneration[key] = generation;
    this.#validating = { ...this.#validating, [key]: true };

    const program = effect.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (this.#validatingGeneration[key] === generation) {
            this.#validating = { ...this.#validating, [key]: false };
          }
        }),
      ),
    );

    this.#fibers[key] = this.#runtime.runFork(program);
  }

  /**
   * Handle a field's value actually changing: the field's server-sourced
   * error (if any) is superseded — clear it — then run whichever validators
   * apply for the `"change"` trigger.
   */
  #onFieldChanged(path: FormPath): void {
    this.#sourced = clearSourceAt(this.#sourcedSnapshot(), "server", path);
    this.#runFieldTrigger(path, "change");
    this.#recomputeValid();
  }

  /** Handle a field losing focus: run whichever validators apply for the `"blur"` trigger. */
  #onFieldBlurred(path: FormPath): void {
    this.#runFieldTrigger(path, "blur");
    this.#recomputeValid();
  }

  /**
   * Run `path`'s sync + async validators for `trigger` (resolved by its
   * `Validate.on` binding, against the current data). When no sync validator
   * applies, falls back to a whole-schema {@link validateField} re-run once
   * the form has been posted and {@link Mode.ParsedMode.revalidate} names
   * this trigger — the "fixing a field clears its error without a resubmit"
   * behaviour.
   */
  #runFieldTrigger(path: FormPath, trigger: FieldTrigger): void {
    const bound = this.#fieldValidators[Path.toString(path)];
    const run: Validate.FieldRun<R> =
      bound === undefined
        ? { sync: Option.none(), async: Option.none() }
        : bound.resolve(trigger, this.data);

    if (Option.isSome(run.sync)) {
      this.#setClientMessagesAt(path, run.sync.value);
      this.#hasValidated = true;
    } else if (this.#shouldFallBackToRevalidate(trigger)) {
      this.#applyRevalidateFallback(path);
    }

    if (Option.isSome(run.async)) {
      this.#hasValidated = true;
      this.#runAsyncFieldValidator(path, trigger, run.async.value);
    }
  }

  /** Whether, absent a registered validator, a whole-schema fallback revalidation applies for `trigger`. */
  #shouldFallBackToRevalidate(trigger: FieldTrigger): boolean {
    return this.isPosted && this.#revalidatesOn(trigger) && this.#options.schema !== undefined;
  }

  /** Re-run the whole-schema client validation and adopt just `path`'s messages. */
  #applyRevalidateFallback(path: FormPath): void {
    this.#sourced = setSourceAt(
      this.#sourcedSnapshot(),
      "client",
      path,
      this.#validateFieldAt(path),
    );
    this.#hasValidated = true;
  }

  /** Replace `path`'s client messages with `issues`' messages (folding {@link FormIssue}s at the field's own path). */
  #setClientMessagesAt(path: FormPath, issues: ReadonlyArray<FormIssue>): void {
    this.#sourced = setSourceAt(
      this.#sourcedSnapshot(),
      "client",
      path,
      issues.map((issue) => issue.message),
    );
  }

  /**
   * Run `path`'s `trigger` async validator run (debounce included) as an
   * interrupt-on-supersede fiber (via {@link FormStore.#runValidatorFiber}) —
   * the result (unless the fiber is itself later interrupted) replaces the
   * field's client messages.
   */
  #runAsyncFieldValidator(
    path: FormPath,
    trigger: FieldTrigger,
    run: Effect.Effect<ReadonlyArray<FormIssue>, never, R>,
  ): void {
    const fiberKey = `${Path.toString(path)}:${trigger}`;
    this.#runValidatorFiber(
      fiberKey,
      run.pipe(
        Effect.tap((issues) =>
          Effect.sync(() => {
            this.#setClientMessagesAt(path, issues);
            this.#recomputeValid();
          }),
        ),
      ),
    );
  }

  /**
   * Run the builder's `refineEffect` refinements (client-side, when the form
   * was seeded from a {@link FormBuilder}) as a whole-form async validator —
   * interrupt-on-supersede, same as a field's async validator (see {@link
   * FormStore.#runValidatorFiber}). The previous run's issue *paths* are
   * cleared before the fresh ones are merged in, so a superseded run can't
   * leave stale messages behind without disturbing schema-derived client
   * errors set by {@link validate} in between.
   */
  #runRefineEffect(): void {
    const refinements = this.#options.refinements;
    if (refinements === undefined) return;

    // Values that don't decode run no refinements — exactly as on the server
    // — and the schema's own field errors (from `validate`) already report
    // why; the run's empty result still clears the previous run's refinement
    // errors.
    this.#runValidatorFiber(
      "",
      refinements(this.#detachedData()).pipe(
        Effect.tap((issues) =>
          Effect.sync(() => {
            const cleared = Arr.reduce(
              this.#lastRefinementPaths,
              this.#sourcedSnapshot().client,
              (client, path) => replaceAt(client, path, []),
            );
            const client = Errors.mergeErrors(cleared, Errors.issuesToErrors(issues));
            this.#lastRefinementPaths = issues.map((issue) => issue.path);
            this.#sourced = { ...this.#sourced, client };
            this.#recomputeValid();
          }),
        ),
      ),
    );
  }

  /**
   * Reset `data`, `errors`, and `message` back to the tainted baseline. Pass
   * `values` to re-seed that baseline first (e.g. adopting a different
   * entity's values) instead of returning to the original seed.
   */
  reset(values?: A): void {
    if (values !== undefined) this.#initial = structuredClone(values);
    Arr.forEach(R.keys(this.#fibers), (key) => this.#interruptFiber(key));
    this.data = structuredClone(this.#initial);
    this.#previousData = this.#detachedData();
    this.#sourced = emptySourced;
    this.message = undefined;
    this.isValid = false;
    this.isPosted = false;
    this.#touched = {};
    this.#dirtied = {};
    this.#lastSubmitted = Option.none();
    this.#hasValidated = false;
    this.#validating = {};
    this.#lastRefinementPaths = [];
    this.submissionAttempts = 0;
    this.#lastSubmitOutcome = Option.none();
  }

  /** A serialisable snapshot for SvelteKit's `snapshot` capture/restore. */
  capture(): FormState<A, Message> {
    const state = State.make<A, Message>(this.#detachedData(), {
      id: this.id,
      isValid: this.isValid,
      isPosted: this.isPosted,
      errors: this.#mergedErrors,
      constraints: this.constraints,
    });
    return this.message === undefined ? state : State.withMessage(state, this.message);
  }

  /**
   * An independent deep copy of `data`, detached from the live `$state`
   * proxy. `structuredClone` can't clone the proxy directly (Node's
   * structured-clone algorithm rejects it); take a plain snapshot first, per
   * Svelte's own guidance for this exact case.
   */
  #detachedData(): A {
    // Svelte's `Snapshot<A>` cannot be related back to a generic `A`, and
    // computing it through the recursive `FormValue` constraint never
    // terminates, so the snapshot is typed one level deep (a leaf, or an object).
    const snapshot = $state.snapshot<Path.FormLeaf | object>(this.data);
    // SAFETY: `data` holds an `A`, and `$state.snapshot` of form data (plain,
    // structured-cloneable values) is a deep copy of the same shape; this is
    // the one point that claims `A` back.
    return structuredClone(snapshot) as A;
  }

  /** Restore from a {@link capture} snapshot (its merged tree becomes the server tree; the client tree clears). */
  restore(snapshot: FormState<A, Message>): void {
    this.data = structuredClone(snapshot.data);
    this.#previousData = this.#detachedData();
    this.#sourced = { client: noErrors, server: snapshot.errors };
    this.message = snapshot.message;
    this.isValid = snapshot.isValid;
    this.isPosted = snapshot.isPosted;
    this.constraints = snapshot.constraints ?? {};
    this.#hasValidated = snapshot.isPosted;
  }

  /**
   * Apply server-sourced `data` + `errors` directly, bypassing a submit
   * round-trip — for glue code that repopulates the store from a derived
   * result it received some other way (e.g.
   * {@link module:effect-forms-svelte/SvelteKit}'s `applyActionResult`, from
   * a SvelteKit form action's failure). Sets `isPosted` so
   * {@link shouldShowError} shows the new errors immediately; `isValid` is
   * always `false` (the caller only reaches for this on a failure result).
   */
  setServerState(data: A, errors: FormErrors): void {
    this.data = data;
    this.#previousData = structuredClone(data);
    this.#sourced = { client: noErrors, server: errors };
    this.isValid = false;
    this.isPosted = true;
    this.#hasValidated = true;
  }

  #applyUpdate(update: FormUpdate<A, Message>, result: FormActionResult<A, Message>): void {
    this.#options.onUpdate?.({ update, result });
    if (update.redirect !== undefined) return this.#applyRedirect(update.redirect);
    if (update.error !== undefined) return this.#applyError(update.error);
    if (update.data !== undefined) this.#applySubmittedData(update.data, result);

    // A submission result is authoritative: it superseded whatever the client
    // last computed, so the client tree clears and the response becomes the
    // new server tree (server errors are then cleared field-by-field as the
    // user edits / revalidates — see #onFieldChanged / #runFieldTrigger).
    this.#sourced = { client: noErrors, server: update.errors ?? noErrors };
    this.#hasValidated = true;
    this.message = update.message;
    if (update.isValid !== undefined) this.isValid = update.isValid;
    this.#lastSubmitOutcome = Option.some(this.isValid ? "success" : "failure");
    this.isPosted = true;
    this.#options.onUpdated?.({
      form: { data: this.data, errors: this.#mergedErrors, isValid: this.isValid },
    });
  }

  #applyRedirect(location: string): void {
    this.#lastSubmitOutcome = Option.some("success");
    if (this.#options.onRedirect) this.#options.onRedirect({ location });
    else if (!P.isUndefined(globalThis.window)) window.location.assign(location);
  }

  #applyError(error: string): void {
    this.#lastSubmitOutcome = Option.some("failure");
    this.#options.onError?.({ error });
  }

  /**
   * Adopt (or discard) the submission's echoed data via {@link
   * computeDataApplication} and rebase the tainted baseline. An
   * auto-submitting (live-save) form keeps its local data as the source of
   * truth: adopting the server's echo would discard keystrokes made during
   * the round-trip and, when the echo isn't byte-identical (a trimmed or
   * server-stamped field), retrigger the change watcher — an extra submit,
   * or an endless loop for a non-idempotent echo. On a successful submit the
   * tainted baseline still rebases to whatever `data` ends up holding, so
   * `isTainted` (and the `beforeunload` guard it drives) reflects what was
   * actually just saved, not the original seed.
   */
  #applySubmittedData(data: A, result: FormActionResult<A, Message>): void {
    // Both are detached from `data`'s proxy: `#lastSubmitted` is `$state.raw`.
    const submittedData = Option.getOrElse(this.#lastSubmitted, () => this.#detachedData());
    const applied = computeDataApplication({
      isSuccess: P.isTagged(result, "Success"),
      appliedData: data,
      initial: this.#initial,
      // The snapshot actually sent (see `#runSubmit`), not the live `data` —
      // further edits may have landed while this request was in flight.
      // Detached (`$state.snapshot`) so the `structuredClone`s below never
      // receive a `$state` proxy via `applied.data` / `applied.rebaseTo`.
      submittedData,
      resetForm: this.#options.resetForm ?? false,
      autoSubmit: this.#mode.autoSubmit,
    });
    if (Option.isSome(applied.data)) this.data = structuredClone(applied.data.value);
    if (Option.isSome(applied.rebaseTo)) {
      this.#initial = structuredClone(applied.rebaseTo.value);
      this.#touched = {};
    }
    // Resync the field-tracking watcher's baseline to whatever `data` ends up
    // holding post-submit, so it doesn't re-diff (and re-run field validators
    // / re-clear server errors for) the submission's own echo.
    this.#previousData = this.#detachedData();
  }

  async #runSubmit(
    node: HTMLFormElement,
    submitter: Option.Option<HTMLElement> = Option.none(),
  ): Promise<void> {
    // `new FormData(node, submitter)` folds the clicked button's name/value in,
    // matching the native no-JS POST; the auto-submit path calls this with no
    // submitter by definition, so it keeps its current (button-less) body.
    const formData = new FormData(node, Option.getOrNull(submitter));
    let cancelled = false;
    let resolved: Option.Option<FormActionResult<A, Message>> = Option.none();
    await this.#options.onSubmit?.({
      data: this.data,
      formData,
      form: node,
      submitter,
      cancel: () => {
        cancelled = true;
      },
      resolve: (result) => {
        resolved = Option.some(result);
      },
    });
    if (cancelled) return;

    // Snapshot what we're sending so `revertToLastSubmit` / `changedSinceSubmit`
    // measure against the submitted values.
    this.#lastSubmitted = Option.some(this.#detachedData());
    this.submissionAttempts++;

    this.submitting = true;
    const delayMs = this.#options.delayMs ?? 500;
    const delayTimer = setTimeout(() => {
      this.delayed = true;
    }, delayMs);

    const send = Option.match(resolved, {
      onNone: () => this.#send(formData, node),
      onSome: (result) => Effect.succeed(result),
    });
    await this.#submitRuntime.runPromise(
      send.pipe(
        Effect.flatMap((result) =>
          Effect.try({
            try: () => {
              this.#options.onResult?.({ result });
              this.#applyUpdate(resultToUpdate(result), result);
            },
            catch: submissionFailed,
          }),
        ),
        Effect.catchTag("SubmissionFailed", ({ message }) =>
          Effect.sync(() => {
            this.#lastSubmitOutcome = Option.some("failure");
            this.#options.onError?.({ error: message });
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            clearTimeout(delayTimer);
            this.submitting = false;
            this.delayed = false;
          }),
        ),
      ),
    );
  }

  /**
   * The submission's result, from the first of these the options supply:
   * `handler` (the data, in JS), `submit` (the body, to the action), or the
   * default `HttpClient` POST. A throw or rejection fails the Effect with a
   * {@link SubmissionFailed}.
   */
  #send(
    formData: FormData,
    node: HTMLFormElement,
  ): Effect.Effect<FormActionResult<A, Message>, SubmissionFailed, HttpClient.HttpClient> {
    const { handler, submit } = this.#options;
    if (handler) {
      return Effect.tryPromise({ try: async () => handler(this.data), catch: submissionFailed });
    }
    const action = node.action || (P.isUndefined(globalThis.location) ? "" : location.href);
    if (submit) {
      return Effect.tryPromise({
        try: async () => submit(formData, action, node),
        catch: submissionFailed,
      });
    }
    return defaultSubmit(formData, action);
  }

  /**
   * Progressive-enhancement form action. Use as `<form use:form.enhance>` (or
   * spread {@link FormStore.props}). Intercepts submit, runs the `onSubmit`
   * handler, then sends the body and applies the result. Without JavaScript the
   * form posts normally.
   */
  enhance = (node: HTMLFormElement) => {
    const handleSubmit = (event: SubmitEvent): void => {
      event.preventDefault();
      void this.#runSubmit(node, Option.fromNullishOr(event.submitter));
    };
    node.addEventListener("submit", handleSubmit);

    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (this.#options.taintedMessage && this.isTainted) event.preventDefault();
    };
    if (this.#options.taintedMessage && !P.isUndefined(globalThis.window)) {
      window.addEventListener("beforeunload", beforeUnload);
    }

    // Remember the mounted node so `onChange` / `onBlur` auto-submit can post.
    this.#autoSubmitNode = Option.some(node);

    this.#options.listeners?.onMount?.({ data: this.#detachedData() });

    // Two independent watchers over `data`, both rooted so they get explicit
    // teardown alongside the DOM listeners:
    //  - the `onChange`-mode one re-validates (and maybe auto-submits) the
    //    whole form, debounced by `mode.debounce`, and dispatches any
    //    configured change listeners (independent of mode, so listeners fire
    //    whichever mode the form validates in);
    //  - the field-tracking one diffs against the last-seen snapshot and runs
    //    per-field validators / clears superseded server errors for exactly
    //    the paths that changed — independent of `mode.validation`, since a
    //    field's own validators and the post-submit revalidate mode both
    //    apply regardless of the whole-form trigger. Always on (not gated on
    //    whether any validator is registered yet): `setFieldValidators` can
    //    register one after mount (its documented use case — a field that
    //    doesn't exist until an array item is appended), and a gate evaluated
    //    only at mount time would silently never watch for it.
    const dispatchListeners = this.#buildDispatchListeners();
    let stopWatching: Option.Option<() => void> = Option.none();
    if (this.#mode.validation === "onChange" || Option.isSome(dispatchListeners)) {
      let previous = this.#detachedData();
      stopWatching = Option.some(
        $effect.root(() => {
          $effect(() => {
            // Establish a deep dependency on the data tree.
            const snapshot = this.#detachedData();
            if (this.#mode.validation === "onChange" && (this.isTainted || this.isPosted)) {
              this.#scheduleValidation();
            }
            if (Option.isSome(dispatchListeners)) {
              dispatchChange(previous, snapshot, dispatchListeners.value);
            }
            previous = snapshot;
          });
        }),
      );
    }

    const stopFieldWatching = $effect.root(() => {
      $effect(() => {
        const snapshot = this.#detachedData();
        const changed = taintedLeafPaths(computeTainted(this.#previousData, snapshot));
        this.#previousData = snapshot;
        Arr.forEach(changed, (path) => this.#onFieldChanged(path));
      });
    });

    return {
      destroy: () => {
        node.removeEventListener("submit", handleSubmit);
        if (!P.isUndefined(globalThis.window))
          window.removeEventListener("beforeunload", beforeUnload);
        if (Option.isSome(stopWatching)) stopWatching.value();
        stopFieldWatching?.();
        this.#clearValidateTimer();
        Arr.forEach(R.values(this.#listenerTimers), (timer) => clearTimeout(timer));
        this.#listenerTimers = {};
        Arr.forEach(R.keys(this.#fibers), (key) => this.#interruptFiber(key));
        if (Option.contains(this.#autoSubmitNode, node)) this.#autoSubmitNode = Option.none();
      },
    };
  };

  /** Attachment form of {@link FormStore.enhance} for {@link FormStore.props}. */
  readonly #enhanceAttachment = (node: Element): (() => void) => {
    // Only reachable through `props`, which belongs on a `<form>`
    // (`<form {...form.props}>`); anywhere else is a usage error.
    if (!(node instanceof HTMLFormElement)) {
      throw new TypeError(
        `FormStore.props must be spread onto a <form>, not a <${node.localName}>`,
      );
    }
    return this.enhance(node).destroy;
  };

  /**
   * Build a {@link FormData} body from the current data (SPA / manual submit).
   *
   * Each value is encoded as `objectToFormData` encodes it: a `File` or
   * `Blob` is appended as a file and a `Date` as its UTC `YYYY-MM-DD`.
   */
  toFormData(): FormData {
    return objectToFormData(this.data);
  }
}

/**
 * A schema a {@link FormStore} can bind: service-free (so the browser
 * validates synchronously), with a decoded and an encoded side that are both
 * {@link Path.FormValue} trees (so the store can hold, walk and post them).
 */
export type FormSchema = Validate.ServiceFreeSchema & {
  readonly Type: Path.FormValue;
  readonly Encoded: Path.FormValue;
};

/** `Schema.Struct` fields made of {@link FormSchema}s — what a store-bound {@link FormBuilder} accumulates. */
export type FormFields = { readonly [key: string]: FormSchema };

/** A schema plus its blank-form defaults — what {@link createForm} wraps `Form.make` over. */
export interface FormSeed<S extends FormSchema> {
  readonly schema: S;
  readonly defaults: S["Type"];
  readonly id?: string;
}

/**
 * The data of a builder store seeded without `defaults`: one
 * {@link Path.FormValue} per field. Its blank is schema-derived (`""`, `[]`
 * or a struct of blanks), which need not be a valid encoded value, so the
 * data is typed no tighter than what a field can hold.
 */
export type DraftData<F extends FormFields> = Readonly<Record<keyof F & string, Path.FormValue>>;

/** Options for the {@link createForm} {@link FormBuilder} overloads. */
export type FormBuilderOptions<F extends FormFields, A, Message, R = never> = FormOptions<
  Schema.Struct<F>,
  A,
  Message,
  R
> & {
  /** Distinguishes multiple forms on a page. Defaults to `"default"`. */
  readonly id?: string;
};

/** The `layer` member of a {@link createForm} overload whose `R` is `never`: none. */
export interface NoLayer {
  readonly layer?: never;
}

/** The `layer` member of a {@link createForm} overload whose `R` needs services. */
export interface WithLayer<R> {
  readonly layer: Layer.Layer<R>;
}

/** A {@link createForm} builder overload's encoded `defaults`, which the blank form holds. */
export interface WithDefaults<F extends FormFields> {
  /** Blank-form values (encoded, as the form holds them). */
  readonly defaults: FormBuilder.Encoded<F>;
}

/** A {@link createForm} builder overload without `defaults`: the blank form holds schema-derived blanks. */
export interface WithoutDefaults {
  readonly defaults?: never;
}

/** The argument lists {@link createForm}'s overloads accept, one tuple per overload. */
type CreateFormArgs<
  F extends FormFields,
  S extends FormSchema,
  A extends Path.FormValue,
  R,
  Message,
> =
  | readonly [
      FormBuilder.FormBuilder<F>,
      FormBuilderOptions<F, FormBuilder.Encoded<F>, Message> & WithDefaults<F> & NoLayer,
    ]
  | readonly [
      FormBuilder.FormBuilder<F, R>,
      FormBuilderOptions<F, FormBuilder.Encoded<F>, Message, R> & WithDefaults<F> & WithLayer<R>,
    ]
  | readonly [FormBuilder.FormBuilder<F>]
  | readonly [
      FormBuilder.FormBuilder<F>,
      FormBuilderOptions<F, DraftData<F>, Message> & WithoutDefaults & NoLayer,
    ]
  | readonly [
      FormBuilder.FormBuilder<F, R>,
      FormBuilderOptions<F, DraftData<F>, Message, R> & WithoutDefaults & WithLayer<R>,
    ]
  | readonly [FormSeed<S>]
  | readonly [FormSeed<S>, FormOptions<S, S["Type"], Message> & NoLayer]
  | readonly [FormSeed<S>, FormOptions<S, S["Type"], Message, R> & WithLayer<R>]
  | readonly [FormState<A, Message>]
  | readonly [FormState<A, Message>, FormOptions<S, A, Message> & NoLayer]
  | readonly [FormState<A, Message>, FormOptions<S, A, Message, R> & WithLayer<R>];

/** The builder's schema, array-item fields and client-side refinements, as store options. */
const builderStoreOptions = <F extends FormFields, RefineR>(
  builder: FormBuilder.FormBuilder<F, RefineR>,
): {
  readonly schema: Schema.Struct<F>;
  readonly fields: Field.FieldsRecord;
  readonly refinements?: FormRefinements<RefineR>;
} => {
  const schema = FormBuilder.buildSchema(builder);
  return Option.match(refinementsOf(builder), {
    onNone: () => ({ schema, fields: builder.fields }),
    onSome: (refinements) => ({ schema, fields: builder.fields, refinements }),
  });
};

/** The `Form.fromBuilder` options (`id`) a builder overload's store options carry. */
const fromBuilderOptions = (options: { readonly id?: string }): { readonly id?: string } =>
  options.id === undefined ? {} : { id: options.id };

/** The blank state a seed's `Form.make` produces. */
const seedState = <S extends FormSchema, Message>(
  seed: FormSeed<S>,
): FormState<S["Type"], Message> => {
  const makeOptions: Mutable<Form.MakeFormOptions<S>> = { defaults: seed.defaults };
  if (seed.id !== undefined) makeOptions.id = seed.id;
  return makeForm<S, Message>(seed.schema, makeOptions).empty();
};

/**
 * Create a reactive {@link FormStore}. Three sources are accepted:
 *
 * - a {@link FormBuilder} — the schema, blank defaults, and array-item defaults
 *   are all derived from the builder (client validation, including
 *   `refineEffect` refinements, is wired automatically). With `defaults` the
 *   data is the builder's encoded type; without, it is {@link DraftData};
 * - `{ schema, defaults }` — seed a blank form (wrapping the core's `Form.make`);
 * - a server-produced {@link FormState} — hydrate from it (schema in `options`).
 *
 * Pass `layer` exactly when a validator or a `refineEffect` refinement needs
 * services; without it the store's `R` is `never`.
 */
export function createForm<F extends FormFields, Message = unknown>(
  builder: FormBuilder.FormBuilder<F>,
  options: FormBuilderOptions<F, FormBuilder.Encoded<F>, Message> & WithDefaults<F> & NoLayer,
): FormStore<Schema.Struct<F>, FormBuilder.Encoded<F>, Message>;
export function createForm<F extends FormFields, R, Message = unknown>(
  builder: FormBuilder.FormBuilder<F, R>,
  options: FormBuilderOptions<F, FormBuilder.Encoded<F>, Message, R> &
    WithDefaults<F> &
    WithLayer<R>,
): FormStore<Schema.Struct<F>, FormBuilder.Encoded<F>, Message, R>;
export function createForm<F extends FormFields, Message = unknown>(
  builder: FormBuilder.FormBuilder<F>,
): FormStore<Schema.Struct<F>, DraftData<F>, Message>;
export function createForm<F extends FormFields, Message = unknown>(
  builder: FormBuilder.FormBuilder<F>,
  options: FormBuilderOptions<F, DraftData<F>, Message> & WithoutDefaults & NoLayer,
): FormStore<Schema.Struct<F>, DraftData<F>, Message>;
export function createForm<F extends FormFields, R, Message = unknown>(
  builder: FormBuilder.FormBuilder<F, R>,
  options: FormBuilderOptions<F, DraftData<F>, Message, R> & WithoutDefaults & WithLayer<R>,
): FormStore<Schema.Struct<F>, DraftData<F>, Message, R>;
export function createForm<S extends FormSchema, Message = unknown>(
  seed: FormSeed<S>,
): FormStore<S, S["Type"], Message>;
export function createForm<S extends FormSchema, Message = unknown>(
  seed: FormSeed<S>,
  options: FormOptions<S, S["Type"], Message> & NoLayer,
): FormStore<S, S["Type"], Message>;
export function createForm<S extends FormSchema, R, Message = unknown>(
  seed: FormSeed<S>,
  options: FormOptions<S, S["Type"], Message, R> & WithLayer<R>,
): FormStore<S, S["Type"], Message, R>;
export function createForm<S extends FormSchema, A extends Path.FormValue, Message = unknown>(
  initial: FormState<A, Message>,
): FormStore<S, A, Message>;
export function createForm<S extends FormSchema, A extends Path.FormValue, Message = unknown>(
  initial: FormState<A, Message>,
  options: FormOptions<S, A, Message> & NoLayer,
): FormStore<S, A, Message>;
export function createForm<S extends FormSchema, A extends Path.FormValue, R, Message = unknown>(
  initial: FormState<A, Message>,
  options: FormOptions<S, A, Message, R> & WithLayer<R>,
): FormStore<S, A, Message, R>;
export function createForm<
  F extends FormFields,
  S extends FormSchema,
  A extends Path.FormValue,
  R,
  Message,
>(
  ...args: CreateFormArgs<F, S, A, R, Message>
):
  | FormStore<Schema.Struct<F>, FormBuilder.Encoded<F>, Message, R>
  | FormStore<Schema.Struct<F>, FormBuilder.Encoded<F>, Message>
  | FormStore<Schema.Struct<F>, DraftData<F>, Message, R>
  | FormStore<Schema.Struct<F>, DraftData<F>, Message>
  | FormStore<S, S["Type"], Message, R>
  | FormStore<S, S["Type"], Message>
  | FormStore<S, A, Message, R>
  | FormStore<S, A, Message> {
  type Args = CreateFormArgs<F, S, A, R, Message>;
  type Leading<T> = readonly [T, ...ReadonlyArray<unknown>];
  type Trailing<T> = readonly [unknown, T];
  const isBuilder = (
    a: Args,
  ): a is Extract<Args, Leading<FormBuilder.FormBuilder<F> | FormBuilder.FormBuilder<F, R>>> =>
    FormBuilder.isFormBuilder(a[0]);
  const isSeed = (a: Args): a is Extract<Args, Leading<FormSeed<S>>> =>
    P.hasProperty(a[0], "schema") && P.hasProperty(a[0], "defaults");
  const hasLayer = (a: Args): a is Extract<Args, Trailing<WithLayer<R>>> =>
    a[1]?.layer !== undefined;
  const hasDefaults = (a: Args): a is Extract<Args, Trailing<WithDefaults<F>>> =>
    P.hasProperty(a[1], "defaults") && a[1].defaults !== undefined;

  if (isBuilder(args)) {
    if (hasDefaults(args)) {
      if (hasLayer(args)) {
        const [builder, options] = args;
        const blank = { ...fromBuilderOptions(options), defaults: options.defaults };
        const state = Form.fromBuilder<F, R, Message>(builder, blank).empty();
        return new FormStore<Schema.Struct<F>, FormBuilder.Encoded<F>, Message, R>(state, {
          ...options,
          ...builderStoreOptions(builder),
        });
      }
      const [builder, options] = args;
      const blank = { ...fromBuilderOptions(options), defaults: options.defaults };
      const state = Form.fromBuilder<F, never, Message>(builder, blank).empty();
      return new FormStore<Schema.Struct<F>, FormBuilder.Encoded<F>, Message>(state, {
        ...options,
        ...builderStoreOptions(builder),
        layer: Layer.empty,
      });
    }
    if (hasLayer(args)) {
      const [builder, options] = args;
      const state: FormState<DraftData<F>, Message> = Form.fromBuilder<F, R, Message>(
        builder,
        fromBuilderOptions(options),
      ).empty();
      return new FormStore<Schema.Struct<F>, DraftData<F>, Message, R>(state, {
        ...options,
        ...builderStoreOptions(builder),
      });
    }
    const [builder, options = {}] = args;
    const state: FormState<DraftData<F>, Message> = Form.fromBuilder<F, never, Message>(
      builder,
      fromBuilderOptions(options),
    ).empty();
    return new FormStore<Schema.Struct<F>, DraftData<F>, Message>(state, {
      ...options,
      ...builderStoreOptions(builder),
      layer: Layer.empty,
    });
  }
  if (isSeed(args)) {
    if (hasLayer(args)) {
      const [seed, options] = args;
      return new FormStore<S, S["Type"], Message, R>(seedState<S, Message>(seed), {
        ...options,
        schema: seed.schema,
      });
    }
    const [seed, options = {}] = args;
    return new FormStore<S, S["Type"], Message>(seedState<S, Message>(seed), {
      ...options,
      schema: seed.schema,
      layer: Layer.empty,
    });
  }
  if (hasLayer(args)) return new FormStore<S, A, Message, R>(args[0], args[1]);
  const [initial, options = {}] = args;
  return new FormStore<S, A, Message>(initial, { ...options, layer: Layer.empty });
}
