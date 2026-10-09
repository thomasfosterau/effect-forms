/**
 * The reactive Svelte 5 form store.
 *
 * {@link createForm} binds a schema to a reactive, rune-backed {@link FormStore}.
 * Give it either `{ schema, defaults }` (it wraps the core's `Form.make` to seed
 * an empty form) or a server-produced {@link FormState} to hydrate from. The
 * store exposes mutable `data` (bind inputs to it), typed `errors`
 * (`form.errors.name`), `submitting` / `delayed` / `message` / `valid`, tainted
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
 * `validators` (keyed by {@link Path.toString}) attach per-field sync/async
 * validators (the `FieldValidators` shape — TanStack Form's `onChange(Async)`
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

import {
  Constraints,
  Errors,
  Field,
  Form,
  FormBuilder,
  Issues,
  Mode,
  Path,
  Result,
  State,
  Validate,
} from "@thomasfosterau/effect-forms";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import type * as Schema from "effect/Schema";
import { createAttachmentKey } from "svelte/attachments";
import { validateData, validateField } from "./ClientValidate.ts";
import {
  computeDataApplication,
  type FormUpdate,
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
type TypedFormErrors<A> = Errors.TypedFormErrors<A>;
type InputConstraint = Constraints.InputConstraint;
type InputConstraints = Constraints.InputConstraints;
type LeafFormatter = Issues.LeafFormatter;
/** How a form validates (and optionally auto-submits, and revalidates after a post) as the user types. */
export type FormMode = Mode.FormMode;
/** A field's sync / async validators — see {@link module:effect-forms/Validate}. */
export type FieldValidators<A, R = never> = Validate.FieldValidators<A, R>;
const { clearSourceAt, emptySourced, hasErrors, mergeSourced, noErrors, replaceAt, setSourceAt } =
  Errors;
const { getAt, setAt } = Path;
const makeForm = Form.make;

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
 * A typed, reactive handle to one field, returned by {@link FormStore.field}.
 * Bundles everything a single input needs — `bind:value={field.value}`,
 * `name={field.name}`, `onblur={field.handleBlur}`, `{...field.constraints}`,
 * `field.visibleErrors`, `field.meta` — instead of wiring each by hand against
 * an untyped {@link FormPath}. See {@link Path.FieldPath} for how the path is
 * type-checked.
 */
export class FieldHandle<V> {
  readonly #store: FormStore<Schema.Top, object, unknown>;
  readonly #path: FormPath;
  /** The path in flat field-name notation — use as the input's `name` attribute. */
  readonly name: string;

  constructor(store: FormStore<Schema.Top, object, unknown>, path: FormPath) {
    this.#store = store;
    this.#path = path;
    this.name = Path.toString(path);
  }

  /** The field's current value. Assignable — `bind:value={field.value}` works. */
  get value(): V {
    return this.#store.valueAt(this.#path) as V;
  }

  set value(next: V) {
    this.#store.setValue(this.#path, next);
  }

  /** All messages currently attached to this field. */
  get errors(): readonly string[] {
    return this.#store.errorsAt(this.#path);
  }

  /** This field's messages, gated by the form's validation mode (see {@link FormStore.shouldShowError}). */
  get visibleErrors(): readonly string[] {
    return this.#store.visibleErrorsAt(this.#path);
  }

  /** Native validation attributes for this field — spread onto the `<input>`. */
  get constraints(): InputConstraint {
    return this.#store.constraintAt(this.#path);
  }

  /** This field's {@link FieldMeta}. */
  get meta(): FieldMeta {
    const isBlurred = this.#store.isTouchedAt(this.#path);
    const isDirty = this.#store.isDirtyAt(this.#path);
    return {
      isTouched: isBlurred || isDirty,
      isBlurred,
      isDirty,
      isDefaultValue: this.#store.isDefaultValueAt(this.#path),
    };
  }

  /** Mark this field blurred — see {@link FormStore.handleBlur}. */
  handleBlur = (): void => {
    this.#store.handleBlur(this.#path);
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
   * `new FormData(form, submitter)` semantics), or `null` for an auto-submit
   * (no button was clicked).
   */
  readonly submitter: HTMLElement | null;
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
export interface FormOptions<S extends Schema.Top, A, Message, R = never> {
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
   * The builder itself, set automatically when {@link createForm} is given a
   * {@link FormBuilder}. Its `refineEffect` refinements run client-side as a
   * whole-form async validator whenever {@link FormStore.validate} runs.
   */
  readonly builder?: FormBuilder.FormBuilder<Field.FieldsRecord, R>;
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
   * Per-field sync/async validators, keyed by {@link Path.toString} (e.g.
   * `"author.name"`, `"tags[0]"`). See {@link FormStore.setFieldValidators} to
   * register these dynamically instead (e.g. once an array item exists).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly validators?: Record<string, FieldValidators<any, R>>;
  /**
   * Services an async field validator or a builder's `refineEffect`
   * refinement needs on its `R` channel. A `ManagedRuntime` is built from
   * this once per store and reused for every client-side Effect run.
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
    readonly form: { readonly data: A; readonly errors: FormErrors; readonly valid: boolean };
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

const defaultSubmit = async <A, Message>(
  body: FormData,
  action: string,
): Promise<FormActionResult<A, Message>> => {
  const response = await fetch(action, {
    method: "POST",
    body,
    headers: { accept: "application/json" },
  });
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return {
      _tag: "Error",
      status: response.status,
      message: response.statusText || "Request failed",
    };
  }
  return parseActionResult<A, Message>(parsed, response.status);
};

/** Whether `index` is a valid position in an array of `length`. */
const inRange = (index: number, length: number): boolean => index >= 0 && index < length;

/** A field trigger a validator or the revalidate mode reacts to. */
type FieldTrigger = "change" | "blur";

/** A reactive form, returned by {@link createForm}. */
export class FormStore<S extends Schema.Top, A = S["Type"], Message = unknown, R = never> {
  /** The reactive form data — bind inputs to its fields. */
  data: A = $state()!;
  /** The current status message, if any. */
  message: Message | undefined = $state();
  /** Native input constraints derived server-side. */
  constraints: InputConstraints = $state({});
  /** Whether a submission is in flight. */
  submitting = $state(false);
  /** Whether the in-flight submission has passed `delayMs`. */
  delayed = $state(false);
  /** Whether the current state came from a submission. */
  posted = $state(false);
  /** Whether the last validation/submit was valid. */
  valid = $state(false);
  /** How many times {@link FormStore.enhance}'s submit handler has actually attempted a submission. */
  submissionAttempts = $state(0);

  /** The values sent by the last submission (for revert / changed-since-submit). */
  #lastSubmitted: A | undefined = $state();
  /**
   * Per-field blurred flags, keyed by {@link Path.toString}. Drives `onBlur`
   * display (via {@link shouldShowError}) and {@link FieldMeta.isBlurred}.
   */
  #touched: Record<string, boolean> = $state({});
  /**
   * Per-field persistent dirty flags, keyed by {@link Path.toString}. Set once
   * a field's value is changed away from its default via {@link setValue} or
   * an array mutator (`append` / `removeItem` / `swap` / `move`), and never
   * cleared except by {@link reset} — unlike {@link taintedAt}, a revert to the
   * default value does not clear it. Backs {@link FieldMeta.isDirty}. Only
   * tracks writes made through those methods — mutating `data` directly
   * (`bind:value={form.data.x}`, bypassing {@link FormStore.field}) never marks
   * a field dirty.
   */
  #dirtied: Record<string, boolean> = $state({});
  /** Parallel error trees — see {@link Errors.SourcedErrors}. `errors` is their merged view. */
  #sourced: Errors.SourcedErrors = $state(emptySourced);
  /** Whether *any* validation (whole-form or per-field) has run yet — see {@link canSubmit}. */
  #hasValidated = $state(false);
  /** Per-field / whole-form ("") async-validation-in-flight flags, keyed by `"<path>:<trigger>"` or `""`. */
  #validating: Record<string, boolean> = $state({});
  /** Per-key run counter guarding `#validating` writes — see {@link FormStore.#runValidatorFiber}. */
  #validatingGeneration: Record<string, number> = {};
  /** The outcome of the last completed submission, for {@link isSubmitSuccessful}. */
  #lastSubmitOutcome: "success" | "failure" | undefined = $state(undefined);

  readonly id: string;
  /** The tainted baseline `tainted`/`isTainted` compare against — rebased on every successful submit. */
  #initial: A;
  readonly #options: FormOptions<S, A, Message, R>;
  readonly #mode: Mode.ParsedMode;
  readonly #attachmentKey = createAttachmentKey();
  readonly #runtime: ManagedRuntime.ManagedRuntime<R, never>;
  #autoSubmitNode: HTMLFormElement | undefined;
  #validateTimer: ReturnType<typeof setTimeout> | undefined;
  /** Per-field-listener debounce timers, keyed by `"change:<path>"` / `"blur:<path>"`. */
  readonly #listenerTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Per-field validators, keyed by {@link Path.toString}; seeded from `options.validators`. */
  #fieldValidators: Record<string, FieldValidators<unknown, R>>;
  /** In-flight async-validator fibers, keyed by `"<path>:<trigger>"` (fields) or `""` (whole-form `refineEffect`). */
  #fibers: Record<string, Fiber.Fiber<unknown, never>> = {};
  /** The error paths the last `refineEffect` run set, so the next run can clear exactly those before merging fresh ones. */
  #lastRefinementPaths: FormPath[] = [];
  /** The data snapshot the field-tracking watcher last diffed against. */
  #previousData: A;

  /** The current nested error tree (server errors merged with client errors), typed to the form data's shape. */
  readonly errors: TypedFormErrors<A> = $derived.by(() => mergeSourced(this.#sourced) as never);
  /** Client-side-sourced errors only (schema, per-field validators, `refineEffect`). */
  readonly clientErrors: TypedFormErrors<A> = $derived.by(() => this.#sourced.client as never);
  /** Server-sourced errors only (the last submission's response). */
  readonly serverErrors: TypedFormErrors<A> = $derived.by(() => this.#sourced.server as never);
  /** Whether any async field validator or `refineEffect` run is currently in flight. */
  readonly isValidating: boolean = $derived(Object.values(this.#validating).some(Boolean));
  /** Whether the form has ever been submitted (attempted). */
  readonly isSubmitted: boolean = $derived(this.submissionAttempts > 0);
  /** Whether the most recently *completed* submission succeeded. `false` before any submit completes. */
  readonly isSubmitSuccessful: boolean = $derived(this.#lastSubmitOutcome === "success");
  /**
   * Whether the submit button should be enabled: not mid-submit, not
   * mid-validation, and either nothing has been validated yet (a pristine
   * form isn't presumptively invalid — the server gets the first look) or the
   * last validation run said valid.
   */
  readonly canSubmit: boolean = $derived(
    !this.submitting && !this.isValidating && (!this.#hasValidated || this.valid),
  );

  /** The tainted-field tree, re-derived as `data` changes. */
  readonly tainted: TaintedFields = $derived.by(() => computeTainted(this.#initial, this.data));
  /** Whether any field has been changed since the form was seeded. */
  readonly isTainted: boolean = $derived(isAnyTainted(this.tainted));
  /** The tree of fields changed since the last submission (empty before any submit). */
  readonly changedSinceSubmit: TaintedFields = $derived.by(() =>
    this.#lastSubmitted === undefined ? {} : computeTainted(this.#lastSubmitted, this.data),
  );
  /** Whether anything has changed since the last submission. */
  readonly hasChangedSinceSubmit: boolean = $derived(isAnyTainted(this.changedSinceSubmit));

  constructor(initial: FormState<A, Message>, options: FormOptions<S, A, Message, R> = {}) {
    this.id = initial.id;
    this.#initial = structuredClone(initial.data);
    this.#previousData = structuredClone(initial.data);
    this.#options = options;
    this.#mode = Mode.parse(options.mode);
    // `Layer.empty` is `Layer<never>`; when `options.layer` is omitted the
    // caller is asserting `R` is `never` (no validator / refineEffect
    // refinement on this store demands a service) — the same "caller
    // asserts" contract `validateValueSync` documents for a sync-only schema.
    this.#runtime = ManagedRuntime.make(options.layer ?? (Layer.empty as Layer.Layer<R>));
    this.#fieldValidators = {
      ...(options.validators as Record<string, FieldValidators<unknown, R>> | undefined),
    };
    this.data = structuredClone(initial.data);
    this.#sourced = { client: noErrors, server: (initial.errors ?? noErrors) as FormErrors };
    this.message = initial.message;
    // The `{ schema, defaults }` overload always arrives with `constraints`
    // already derived (via the core's `Form.make`); the `FormState`-hydration
    // overload's caller may not have supplied any, so derive from
    // `options.schema` here too — the two overloads must be symmetric.
    this.constraints =
      initial.constraints ??
      (options.schema ? Constraints.constraintsFromSchema(options.schema) : {});
    this.posted = initial.posted;
    this.valid = initial.valid;
    // `canSubmit` treats "never validated" as presumptively valid (a pristine
    // form isn't guilty until proven so); hydrating from a `posted` state
    // means something already *has* judged it, so `valid` must be trusted
    // from the start — otherwise a server-rejected `FormState` briefly (or
    // permanently, if nothing re-triggers validation) reports `canSubmit: true`.
    this.#hasValidated = initial.posted;
  }

  /**
   * Spreadable attributes for the `<form>` element: `<form {...form.props}>`.
   * Sets `method="post"` (and `action`, if configured) and attaches the
   * progressive-enhancement submit handler via a Svelte attachment.
   */
  get props(): Record<string | symbol, unknown> {
    return {
      method: "post",
      ...(this.#options.action !== undefined ? { action: this.#options.action } : {}),
      [this.#attachmentKey]: this.#enhanceAttachment,
    };
  }

  /** Whether the field at `path` (or anything beneath it) is tainted. */
  taintedAt(path: FormPath): boolean {
    return isTaintedAt(this.tainted, path);
  }

  /** The messages currently attached to `path` (for dynamic / nested paths). */
  errorsAt(path: FormPath): readonly string[] {
    return Errors.getError(this.errors as FormErrors, path) ?? [];
  }

  /** Whether the async validator(s) at `path` are currently running. */
  isValidatingAt(path: FormPath): boolean {
    const key = Path.toString(path);
    return this.#validating[`${key}:change`] === true || this.#validating[`${key}:blur`] === true;
  }

  /**
   * Register (or replace) `path`'s validators — the option-driven equivalent
   * of attaching `validators` at {@link createForm} time, for fields that
   * don't exist until later (e.g. an appended array item).
   */
  setFieldValidators(path: FormPath, validators: FieldValidators<unknown, R>): void {
    this.#fieldValidators = { ...this.#fieldValidators, [Path.toString(path)]: validators };
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
    return this.valid;
  }

  /** Validate a single field against the schema, returning that field's messages. */
  validateField(path: FormPath): readonly string[] {
    if (!this.#options.schema) return this.errorsAt(path);
    return validateField(this.#options.schema, this.data, path, this.#options.validationFormat);
  }

  /** Set the value at `path` (path-addressed, immutable). Bind directly to `data` otherwise. */
  setValue(path: FormPath, value: unknown): void {
    this.data = setAt(this.data, path, value);
    this.#markDirty(path);
    this.#previousData = this.#detachedData();
    this.#onFieldChanged(path);
  }

  /** Read the value at `path`. */
  valueAt(path: FormPath): unknown {
    return getAt(this.data, path);
  }

  /** Mark the field at `path` touched (defaults to `true`) — drives `onBlur` display. */
  setTouched(path: FormPath, touched = true): void {
    this.#touched = { ...this.#touched, [Path.toString(path)]: touched };
  }

  /** Whether the field at `path` has been touched. */
  isTouchedAt(path: FormPath): boolean {
    return this.#touched[Path.toString(path)] === true;
  }

  /**
   * Once a change away from the default at `path` is seen (per the current
   * `data`, against `taintedAt`), sticks until {@link reset}. Called after
   * `data` has already been updated, by every method that writes it
   * (`setValue` and the array mutators below) — writing `data` directly
   * (`bind:value={form.data.x}`) bypasses this, same as it bypasses `tainted`
   * recomputing off anything but `data` itself would.
   */
  #markDirty(path: FormPath): void {
    const key = Path.toString(path);
    if (!this.#dirtied[key] && this.taintedAt(path)) {
      this.#dirtied = { ...this.#dirtied, [key]: true };
    }
  }

  /** Whether the field at `path` was ever changed away from its default — see {@link FieldMeta.isDirty}. */
  isDirtyAt(path: FormPath): boolean {
    return this.#dirtied[Path.toString(path)] === true;
  }

  /** Whether the field at `path` currently holds its default value — the negation of {@link taintedAt}. */
  isDefaultValueAt(path: FormPath): boolean {
    return !this.taintedAt(path);
  }

  /** The native validation attributes for `path` (a leaf of {@link constraints}). */
  constraintAt(path: FormPath): InputConstraint {
    return Constraints.constraintAt(this.constraints, path);
  }

  /**
   * A typed, reactive handle to the field at `path` — see {@link FieldHandle}.
   * `path` is type-checked against the form data's shape (see {@link
   * Path.FieldPath}); a typo'd segment or wrong-shaped path is a compile error.
   */
  field<P extends Path.FieldPath<A>>(path: P): FieldHandle<Path.PathValue<A, P>> {
    return new FieldHandle(
      this as unknown as FormStore<Schema.Top, object, unknown>,
      Path.fromString(path),
    );
  }

  /**
   * Handle a field losing focus: mark it touched, run its `onBlur` /
   * `onBlurAsync` validators (or, once posted, the revalidate-on-blur mode),
   * fire that field's `onBlur` listener (if any, debounced per its config),
   * and — in `onBlur` validation mode — validate the whole form
   * (auto-submitting if configured and something changed since the last
   * submit).
   */
  handleBlur(path: FormPath): void {
    this.setTouched(path, true);
    this.#onFieldBlurred(path);
    const key = Path.toString(path);
    const field = this.#options.listeners?.fields?.[key];
    if (field?.onBlur) {
      // Capture the value at blur time, not at timer-fire time — otherwise a
      // debounced listener would report whatever the field holds *now*, not
      // what it held when it was blurred.
      const value = this.valueAt(path);
      this.#scheduleListener(`blur:${key}`, field.debounce, () => field.onBlur?.({ path, value }));
    }
    if (this.#mode.validation === "onBlur") {
      this.validate();
      if (this.#mode.autoSubmit && this.valid && this.#hasUnsubmittedChanges()) this.#autoSubmit();
    }
  }

  /** Run `run` now, or after `debounce` (per-key timer, replacing any pending run for that key). */
  #scheduleListener(key: string, debounce: Duration.Input | undefined, run: () => void): void {
    if (debounce === undefined) {
      run();
      return;
    }
    clearTimeout(this.#listenerTimers.get(key));
    this.#listenerTimers.set(
      key,
      setTimeout(() => {
        this.#listenerTimers.delete(key);
        run();
      }, Duration.toMillis(debounce)),
    );
  }

  /**
   * The listeners table to dispatch change events against, with each field's
   * `onChange` wrapped in this store's own debounce timer — or `undefined` if
   * nothing is configured to consume a change (an `onMount`-only config, say),
   * so the deep watcher can skip diffing the data tree entirely. Built once
   * per {@link enhance} call rather than per change, since the listener table
   * itself doesn't change across the mount's lifetime.
   */
  #buildDispatchListeners(): FormListeners | undefined {
    const listeners = this.#options.listeners;
    if (!listeners || (listeners.onChange === undefined && !listeners.fields)) return undefined;
    if (!listeners.fields) return listeners;
    const fields: Record<string, FieldListener> = {};
    for (const [key, field] of Object.entries(listeners.fields)) {
      fields[key] = field.onChange
        ? {
            ...field,
            onChange: (input) =>
              this.#scheduleListener(`change:${key}`, field.debounce, () =>
                field.onChange?.(input),
              ),
          }
        : field;
    }
    return { ...listeners, fields };
  }

  /**
   * Whether there are edits worth auto-submitting: before any submit, any
   * change from the seeded values; afterwards, any change since the last
   * submission. Stops `autoSubmit` from re-posting server-echoed data in a loop.
   */
  #hasUnsubmittedChanges(): boolean {
    return this.#lastSubmitted === undefined ? this.isTainted : this.hasChangedSinceSubmit;
  }

  /**
   * Whether an error at `path` should be shown yet, per the validation mode:
   * always after a submit; in `onChange` once the field is tainted; in `onBlur`
   * once it is touched; never in `onSubmit` before posting.
   */
  shouldShowError(path: FormPath): boolean {
    if (this.posted) return true;
    if (this.#mode.validation === "onChange") return this.taintedAt(path);
    if (this.#mode.validation === "onBlur") return this.isTouchedAt(path);
    return false;
  }

  /** The messages at `path`, but only when {@link shouldShowError} allows it. */
  visibleErrorsAt(path: FormPath): readonly string[] {
    return this.shouldShowError(path) ? this.errorsAt(path) : [];
  }

  /** Read the array at `path` (empty when absent). */
  #arrayAt(path: FormPath): readonly unknown[] {
    return (getAt(this.data, path) ?? []) as readonly unknown[];
  }

  /** Append an item to the array at `path` (a blank item is derived when omitted). */
  append(path: FormPath, value?: unknown): void {
    const current = this.#arrayAt(path);
    const item = value !== undefined ? value : this.#defaultItem(path);
    this.data = setAt(this.data, path, [...current, item]);
    this.#markDirty(path);
    this.#previousData = this.#detachedData();
    this.#onFieldChanged(path);
  }

  /**
   * Insert an item into the array at `path` at `index` (clamped to the
   * array's bounds; a non-finite `index` inserts at the end), shifting later
   * items — and their per-index touched flags / errors — up by one. A blank
   * item is derived when `value` is omitted.
   */
  insertItem(path: FormPath, index: number, value?: unknown): void {
    const current = this.#arrayAt(path);
    const at = Math.max(
      0,
      Math.min(Number.isFinite(index) ? index : current.length, current.length),
    );
    const item = value !== undefined ? value : this.#defaultItem(path);
    this.data = setAt(this.data, path, [...current.slice(0, at), item, ...current.slice(at)]);
    this.#markDirty(path);
    this.#remapArrayIndices(path, Path.insertAt(at));
  }

  /**
   * Replace the item at `index` in the array at `path` in place. Drops that
   * index's own touched flag / errors (they described the old value); other
   * indices are untouched.
   */
  replaceItem(path: FormPath, index: number, value: unknown): void {
    const current = this.#arrayAt(path);
    if (!inRange(index, current.length)) return;
    const next = [...current];
    next[index] = value;
    this.data = setAt(this.data, path, next);
    this.#markDirty(path);
    this.#remapArrayIndices(path, Path.replaceAt(index));
  }

  /** Remove every item from the array at `path`, dropping all of its per-index state. */
  clearItems(path: FormPath): void {
    this.data = setAt(this.data, path, []);
    this.#markDirty(path);
    this.#remapArrayIndices(path, Path.clearAll);
  }

  /**
   * Remove the item at `index` from the array at `path`, shifting later
   * items' per-index touched flags / errors down by one so they keep
   * following their row.
   */
  removeItem(path: FormPath, index: number): void {
    const current = this.#arrayAt(path);
    if (!inRange(index, current.length)) return;
    this.data = setAt(
      this.data,
      path,
      current.filter((_, i) => i !== index),
    );
    this.#markDirty(path);
    this.#remapArrayIndices(path, Path.removeAt(index));
    this.#previousData = this.#detachedData();
    this.#onFieldChanged(path);
  }

  /** Swap two items in the array at `path`, swapping their per-index touched flags / errors too. */
  swap(path: FormPath, indexA: number, indexB: number): void {
    const current = this.#arrayAt(path);
    if (!inRange(indexA, current.length) || !inRange(indexB, current.length) || indexA === indexB) {
      return;
    }
    const next = [...current];
    [next[indexA], next[indexB]] = [next[indexB], next[indexA]];
    this.data = setAt(this.data, path, next);
    this.#markDirty(path);
    this.#remapArrayIndices(path, Path.swapAt(indexA, indexB));
    this.#previousData = this.#detachedData();
    this.#onFieldChanged(path);
  }

  /** Move the item at `from` to `to` within the array at `path`, carrying its per-index state along. */
  move(path: FormPath, from: number, to: number): void {
    const current = this.#arrayAt(path);
    if (!inRange(from, current.length) || to < 0 || to >= current.length || from === to) return;
    const next = [...current];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    this.data = setAt(this.data, path, next);
    this.#markDirty(path);
    this.#remapArrayIndices(path, Path.moveAt(from, to));
    this.#previousData = this.#detachedData();
    this.#onFieldChanged(path);
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
    if (this.#lastSubmitted === undefined) return;
    // `#lastSubmitted` is `$state`; reading it yields a proxy `structuredClone`
    // rejects — snapshot first (same rule as `#detachedData`).
    this.data = structuredClone($state.snapshot(this.#lastSubmitted)) as A;
    this.#previousData = this.#detachedData();
    this.#sourced = emptySourced;
  }

  /**
   * Derive a blank item for the array field at `path`, at any nesting depth
   * (e.g. `authors[0].emails`) — by walking the bound schema's AST there when
   * one is available, falling back to a top-level {@link FormOptions.fields}
   * lookup, else `""`.
   */
  #defaultItem(path: FormPath): unknown {
    if (this.#options.schema) return Field.defaultItemAt(this.#options.schema, path);
    const fields = this.#options.fields;
    if (fields && path.length === 1 && typeof path[0] === "string") {
      const def = fields[path[0]];
      if (def && Field.isArrayFieldDef(def)) return Field.defaultValue(def.itemSchema);
    }
    return "";
  }

  /** Submit via the enhanced node, if one is mounted and not already in flight. */
  #autoSubmit(): void {
    if (this.submitting || this.#autoSubmitNode === undefined) return;
    void this.#runSubmit(this.#autoSubmitNode);
  }

  /** Debounced (in `onChange`) whole-form validation, auto-submitting when valid. */
  #scheduleValidation(): void {
    const run = (): void => {
      this.validate();
      if (this.#mode.autoSubmit && this.valid && this.#hasUnsubmittedChanges()) this.#autoSubmit();
    };
    const ms = this.#mode.debounce;
    if (ms !== null && ms > 0) {
      clearTimeout(this.#validateTimer);
      this.#validateTimer = setTimeout(run, ms);
    } else {
      run();
    }
  }

  #recomputeValid(): void {
    this.valid = !hasErrors(mergeSourced(this.#sourced));
  }

  /**
   * A plain (non-`$state`-proxy) snapshot of `#sourced`. `clearSourceAt` /
   * `setSourceAt` / `replaceAt` in the framework-neutral core `structuredClone`
   * their `errors` argument — which throws `DataCloneError` on a live Svelte
   * `$state` proxy — so anywhere `#sourced` (or one of its two branches) feeds
   * one of those calls, snapshot it first.
   */
  #sourcedSnapshot(): Errors.SourcedErrors {
    return $state.snapshot(this.#sourced) as Errors.SourcedErrors;
  }

  /** Whether {@link Mode.ParsedMode.revalidate} names this field trigger. */
  #revalidatesOn(trigger: FieldTrigger): boolean {
    if (this.#mode.revalidate === "never") return false;
    return this.#mode.revalidate === "onChange" ? trigger === "change" : trigger === "blur";
  }

  /** Interrupt (fire-and-forget) any fiber running under `key`, if one is in flight. */
  #interruptFiber(key: string): void {
    const previous = this.#fibers[key];
    if (previous) Effect.runFork(Fiber.interrupt(previous));
    delete this.#fibers[key];
  }

  /**
   * Fork `effect` under `key` as an interrupt-on-supersede fiber, toggling
   * `#validating[key]` for its duration: any fiber already running under
   * `key` is interrupted first (this — not a timer — is what gives "latest
   * wins"; see {@link Validate.runAsyncFieldValidator}). The old and new
   * fiber's `#validating` writes are guarded by a per-key generation counter
   * — `Effect.runFork(Fiber.interrupt(previous))` is fire-and-forget, so the
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
   * Run `path`'s sync + async validators for `trigger` (resolved by {@link
   * Validate.resolveFieldTrigger}). When neither is registered, falls back to
   * a whole-schema {@link validateField} re-run once the form has been
   * posted and {@link Mode.ParsedMode.revalidate} names this trigger — the
   * "fixing a field clears its error without a resubmit" behaviour.
   */
  #runFieldTrigger(path: FormPath, trigger: FieldTrigger): void {
    const validators = this.#fieldValidators[Path.toString(path)];
    const value = getAt(this.data, path);
    const resolved = Validate.resolveFieldTrigger(validators, trigger);

    if (resolved.sync) {
      this.#applySyncFieldValidator(path, resolved.sync, value);
    } else if (this.#shouldFallBackToRevalidate(trigger)) {
      this.#applyRevalidateFallback(path);
    }

    if (resolved.async) {
      this.#hasValidated = true;
      this.#runAsyncFieldValidator(path, trigger, resolved.async, value, resolved.asyncDebounceMs);
    }
  }

  /** Run a field's registered sync validator and set its client messages. */
  #applySyncFieldValidator(
    path: FormPath,
    validator: Validate.SyncFieldValidator<unknown>,
    value: unknown,
  ): void {
    this.#setClientMessagesAt(path, Validate.runSyncFieldValidator(validator, value));
    this.#hasValidated = true;
  }

  /** Whether, absent a registered validator, a whole-schema fallback revalidation applies for `trigger`. */
  #shouldFallBackToRevalidate(trigger: FieldTrigger): boolean {
    return this.posted && this.#revalidatesOn(trigger) && this.#options.schema !== undefined;
  }

  /** Re-run the whole-schema client validation and adopt just `path`'s messages. */
  #applyRevalidateFallback(path: FormPath): void {
    this.#sourced = setSourceAt(this.#sourcedSnapshot(), "client", path, this.validateField(path));
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
   * Run `path`'s `trigger` async validator as an interrupt-on-supersede
   * fiber (via {@link FormStore.#runValidatorFiber}) — the result (unless
   * the fiber is itself later interrupted) replaces the field's client
   * messages.
   */
  #runAsyncFieldValidator(
    path: FormPath,
    trigger: FieldTrigger,
    validator: Validate.AsyncFieldValidator<unknown, R>,
    value: unknown,
    debounceMs: number,
  ): void {
    const fiberKey = `${Path.toString(path)}:${trigger}`;
    this.#runValidatorFiber(
      fiberKey,
      Validate.runAsyncFieldValidator(validator, value, debounceMs).pipe(
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
    const builder = this.#options.builder;
    if (!builder || FormBuilder.asyncRefinements(builder).length === 0) return;

    this.#runValidatorFiber(
      "",
      FormBuilder.runAsyncRefinements(builder, this.data as never).pipe(
        Effect.tap((issues) =>
          Effect.sync(() => {
            let client = this.#sourcedSnapshot().client;
            for (const path of this.#lastRefinementPaths) client = replaceAt(client, path, []);
            client = Errors.mergeErrors(client, Errors.issuesToErrors(issues));
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
    for (const key of Object.keys(this.#fibers)) this.#interruptFiber(key);
    this.data = structuredClone(this.#initial);
    this.#previousData = this.#detachedData();
    this.#sourced = emptySourced;
    this.message = undefined;
    this.valid = false;
    this.posted = false;
    this.#touched = {};
    this.#dirtied = {};
    this.#lastSubmitted = undefined;
    this.#hasValidated = false;
    this.#validating = {};
    this.#lastRefinementPaths = [];
    this.submissionAttempts = 0;
    this.#lastSubmitOutcome = undefined;
  }

  /** A serialisable snapshot for SvelteKit's `snapshot` capture/restore. */
  capture(): FormState<A, Message> {
    return {
      id: this.id,
      valid: this.valid,
      posted: this.posted,
      data: this.#detachedData(),
      errors: this.errors as FormErrors,
      message: this.message,
      constraints: this.constraints,
    };
  }

  /**
   * An independent deep copy of `data`, detached from the live `$state`
   * proxy. `structuredClone` can't clone the proxy directly (Node's
   * structured-clone algorithm rejects it); take a plain snapshot first, per
   * Svelte's own guidance for this exact case.
   */
  #detachedData(): A {
    return structuredClone($state.snapshot(this.data)) as A;
  }

  /** Restore from a {@link capture} snapshot (its merged tree becomes the server tree; the client tree clears). */
  restore(snapshot: FormState<A, Message>): void {
    this.data = structuredClone(snapshot.data);
    this.#previousData = this.#detachedData();
    this.#sourced = { client: noErrors, server: snapshot.errors };
    this.message = snapshot.message;
    this.valid = snapshot.valid;
    this.posted = snapshot.posted;
    this.constraints = snapshot.constraints ?? {};
    this.#hasValidated = snapshot.posted;
  }

  /**
   * Apply server-sourced `data` + `errors` directly, bypassing a submit
   * round-trip — for glue code that repopulates the store from a derived
   * result it received some other way (e.g.
   * {@link module:effect-forms-svelte/SvelteKit}'s `applyActionResult`, from
   * a SvelteKit form action's failure). Sets `posted` so
   * {@link shouldShowError} shows the new errors immediately; `valid` is
   * always `false` (the caller only reaches for this on a failure result).
   */
  setServerState(data: A, errors: FormErrors): void {
    this.data = data;
    this.#previousData = structuredClone(data);
    this.#sourced = { client: noErrors, server: errors };
    this.valid = false;
    this.posted = true;
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
    this.#sourced = { client: noErrors, server: (update.errors ?? noErrors) as FormErrors };
    this.#hasValidated = true;
    this.message = update.message;
    if (update.valid !== undefined) this.valid = update.valid;
    this.#lastSubmitOutcome = this.valid ? "success" : "failure";
    this.posted = true;
    this.#options.onUpdated?.({
      form: { data: this.data, errors: this.errors as FormErrors, valid: this.valid },
    });
  }

  #applyRedirect(location: string): void {
    this.#lastSubmitOutcome = "success";
    if (this.#options.onRedirect) this.#options.onRedirect({ location });
    else if (typeof window !== "undefined") window.location.assign(location);
  }

  #applyError(error: string): void {
    this.#lastSubmitOutcome = "failure";
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
    const applied = computeDataApplication({
      isSuccess: result._tag === "Success",
      appliedData: data,
      initial: this.#initial,
      // The snapshot actually sent (see `#runSubmit`), not the live `data` —
      // further edits may have landed while this request was in flight.
      // Detached (`$state.snapshot`) so the `structuredClone`s below never
      // receive a `$state` proxy via `applied.data` / `applied.rebaseTo`.
      submittedData: $state.snapshot(this.#lastSubmitted ?? this.data) as A,
      resetForm: this.#options.resetForm ?? false,
      autoSubmit: this.#mode.autoSubmit,
    });
    if (applied.data !== undefined) this.data = structuredClone(applied.data);
    if (applied.rebaseTo !== undefined) {
      this.#initial = structuredClone(applied.rebaseTo);
      this.#touched = {};
    }
    // Resync the field-tracking watcher's baseline to whatever `data` ends up
    // holding post-submit, so it doesn't re-diff (and re-run field validators
    // / re-clear server errors for) the submission's own echo.
    this.#previousData = this.#detachedData();
  }

  async #runSubmit(node: HTMLFormElement, submitter: HTMLElement | null = null): Promise<void> {
    // `new FormData(node, submitter)` folds the clicked button's name/value in,
    // matching the native no-JS POST; the auto-submit path calls this with no
    // submitter by definition, so it keeps its current (button-less) body.
    const formData = new FormData(node, submitter);
    let cancelled = false;
    let resolved: FormActionResult<A, Message> | undefined;
    await this.#options.onSubmit?.({
      data: this.data,
      formData,
      form: node,
      submitter,
      cancel: () => {
        cancelled = true;
      },
      resolve: (result) => {
        resolved = result;
      },
    });
    if (cancelled) return;

    // Snapshot what we're sending so `revertToLastSubmit` / `changedSinceSubmit`
    // measure against the submitted values.
    this.#lastSubmitted = this.#detachedData();
    this.submissionAttempts++;

    this.submitting = true;
    const delayMs = this.#options.delayMs ?? 500;
    const delayTimer = setTimeout(() => {
      this.delayed = true;
    }, delayMs);

    try {
      const submit = this.#options.submit ?? defaultSubmit;
      const action = node.action || (typeof location !== "undefined" ? location.href : "");
      let result: FormActionResult<A, Message>;
      if (resolved !== undefined) {
        result = resolved;
      } else if (this.#options.handler) {
        result = await this.#options.handler(this.data);
      } else {
        result = await submit(formData, action, node);
      }
      this.#options.onResult?.({ result });
      this.#applyUpdate(resultToUpdate(result), result);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Submission failed";
      this.#lastSubmitOutcome = "failure";
      this.#options.onError?.({ error: message });
    } finally {
      clearTimeout(delayTimer);
      this.submitting = false;
      this.delayed = false;
    }
  }

  /**
   * Progressive-enhancement form action. Use as `<form use:form.enhance>` (or
   * spread {@link FormStore.props}). Intercepts submit, runs the `onSubmit`
   * handler, then sends the body and applies the result. Without JavaScript the
   * form posts normally.
   */
  enhance = (node: HTMLFormElement): { destroy: () => void } => {
    const handleSubmit = (event: SubmitEvent): void => {
      event.preventDefault();
      void this.#runSubmit(node, event.submitter);
    };
    node.addEventListener("submit", handleSubmit);

    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (this.#options.taintedMessage && this.isTainted) event.preventDefault();
    };
    if (this.#options.taintedMessage && typeof window !== "undefined") {
      window.addEventListener("beforeunload", beforeUnload);
    }

    // Remember the mounted node so `onChange` / `onBlur` auto-submit can post.
    this.#autoSubmitNode = node;

    this.#options.listeners?.onMount?.({ data: $state.snapshot(this.data) });

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
    let stopWatching: (() => void) | undefined;
    if (this.#mode.validation === "onChange" || dispatchListeners !== undefined) {
      let previous = $state.snapshot(this.data);
      stopWatching = $effect.root(() => {
        $effect(() => {
          // Establish a deep dependency on the data tree.
          const snapshot = $state.snapshot(this.data);
          if (this.#mode.validation === "onChange" && (this.isTainted || this.posted)) {
            this.#scheduleValidation();
          }
          if (dispatchListeners !== undefined)
            dispatchChange(previous, snapshot, dispatchListeners);
          previous = snapshot;
        });
      });
    }

    const stopFieldWatching = $effect.root(() => {
      $effect(() => {
        const snapshot = $state.snapshot(this.data) as A;
        const changed = taintedLeafPaths(computeTainted(this.#previousData, snapshot));
        this.#previousData = snapshot;
        for (const path of changed) this.#onFieldChanged(path);
      });
    });

    return {
      destroy: () => {
        node.removeEventListener("submit", handleSubmit);
        if (typeof window !== "undefined") window.removeEventListener("beforeunload", beforeUnload);
        stopWatching?.();
        stopFieldWatching?.();
        clearTimeout(this.#validateTimer);
        for (const timer of this.#listenerTimers.values()) clearTimeout(timer);
        this.#listenerTimers.clear();
        for (const key of Object.keys(this.#fibers)) this.#interruptFiber(key);
        if (this.#autoSubmitNode === node) this.#autoSubmitNode = undefined;
      },
    };
  };

  /** Attachment form of {@link FormStore.enhance} for {@link FormStore.props}. */
  readonly #enhanceAttachment = (node: Element): (() => void) =>
    this.enhance(node as HTMLFormElement).destroy;

  /**
   * Build a {@link FormData} body from the current data (SPA / manual submit).
   *
   * Each value is encoded as {@link objectToFormData} encodes it: a `File` or
   * `Blob` is appended as a file and a `Date` as its UTC `YYYY-MM-DD`.
   */
  toFormData(): FormData {
    return objectToFormData(this.data);
  }
}

/** A schema plus its blank-form defaults — what {@link createForm} wraps `Form.make` over. */
export interface FormSeed<S extends Schema.Top> {
  readonly schema: S;
  readonly defaults: S["Type"];
  readonly id?: string;
}

/** The built-schema type a {@link FormBuilder} of `TFields` / `R` collapses to. */
type BuiltSchema<TFields extends Field.FieldsRecord, R> = Schema.Codec<
  Field.DecodedFromFields<TFields>,
  Field.EncodedFromFields<TFields>,
  R
>;

/** Options for the {@link createForm} {@link FormBuilder} overload. */
export type FormBuilderOptions<TFields extends Field.FieldsRecord, R, Message> = FormOptions<
  BuiltSchema<TFields, R>,
  Field.EncodedFromFields<TFields>,
  Message,
  R
> & {
  /** Blank-form values. Defaults to a schema-derived encoded blank per field. */
  readonly defaults?: Field.EncodedFromFields<TFields>;
  /** Distinguishes multiple forms on a page. Defaults to `"default"`. */
  readonly id?: string;
};

/**
 * Create a reactive {@link FormStore}. Three sources are accepted:
 *
 * - a {@link FormBuilder} — the schema, blank defaults, and array-item defaults
 *   are all derived from the builder (client validation, including
 *   `refineEffect` refinements, is wired automatically);
 * - `{ schema, defaults }` — seed a blank form (wrapping the core's `Form.make`);
 * - a server-produced {@link FormState} — hydrate from it (schema in `options`).
 */
export function createForm<TFields extends Field.FieldsRecord, R, Message = unknown>(
  builder: FormBuilder.FormBuilder<TFields, R>,
  options?: FormBuilderOptions<TFields, R, Message>,
): FormStore<BuiltSchema<TFields, R>, Field.EncodedFromFields<TFields>, Message, R>;
export function createForm<S extends Schema.Top, Message = unknown, R = never>(
  seed: FormSeed<S>,
  options?: FormOptions<S, S["Type"], Message, R>,
): FormStore<S, S["Type"], Message, R>;
export function createForm<S extends Schema.Top, A = S["Type"], Message = unknown, R = never>(
  initial: FormState<A, Message>,
  options: FormOptions<S, A, Message, R>,
): FormStore<S, A, Message, R>;
export function createForm(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  source: FormBuilder.FormBuilder<any, any> | FormSeed<Schema.Top> | FormState<unknown, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options: FormOptions<Schema.Top, any, any, any> & {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    defaults?: any;
    id?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): FormStore<Schema.Top, any, any, any> {
  if (FormBuilder.isFormBuilder(source)) {
    const schema = FormBuilder.buildSchema(source) as Schema.Top;
    const form = Form.fromBuilder(source, {
      ...(options.defaults !== undefined ? { defaults: options.defaults as never } : {}),
      ...(options.id !== undefined ? { id: options.id } : {}),
    });
    return new FormStore(form.empty(), {
      ...options,
      schema,
      fields: source.fields,
      builder: source,
    });
  }
  const isSeed = "defaults" in source && "schema" in source;
  if (isSeed) {
    const seed = source as FormSeed<Schema.Top>;
    const state = makeForm(seed.schema, {
      defaults: seed.defaults,
      ...(seed.id !== undefined ? { id: seed.id } : {}),
    }).empty();
    return new FormStore(state, { ...options, schema: seed.schema });
  }
  return new FormStore(source as FormState<unknown, unknown>, options);
}
