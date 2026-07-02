/**
 * @copyright Thomas Foster
 *
 * The reactive Svelte 5 form store.
 *
 * {@link createForm} binds a schema to a reactive, rune-backed {@link FormStore}.
 * Give it either `{ schema, defaults }` (it wraps the core's `makeForm` to seed
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
} from "@thomasfosterau/effect-forms";
import type * as Schema from "effect/Schema";
import { createAttachmentKey } from "svelte/attachments";
import { validateData, validateField } from "./ClientValidate.ts";
import {
  type FormUpdate,
  objectToFormData,
  parseActionResult,
  resultToUpdate,
} from "./EnhanceCore.ts";
import { computeTainted, isAnyTainted, isTaintedAt, type TaintedFields } from "./Tainted.ts";

// Terse local aliases onto the namespaced core exports (the public API is
// `import { Form, State, … } from "@thomasfosterau/effect-forms"`).
type FormActionResult<A, Message = unknown> = Result.FormActionResult<A, Message>;
type FormErrors = Errors.FormErrors;
type FormPath = Issues.FormPath;
type FormState<A, Message = unknown> = State.FormState<A, Message>;
type TypedFormErrors<A> = Errors.TypedFormErrors<A>;
type InputConstraints = Constraints.InputConstraints;
type LeafFormatter = Issues.LeafFormatter;
/** How a form validates (and optionally auto-submits) as the user types. */
export type FormMode = Mode.FormMode;
const { getError, noErrors } = Errors;
const { getAt, setAt } = Path;
const makeForm = Form.make;

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
export interface FormOptions<S extends Schema.Top, A, Message> {
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
   * given a {@link FormBuilder}. Lets {@link FormStore.append} derive a blank
   * item for a top-level array field from its item schema.
   */
  readonly fields?: Field.FieldsRecord;
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

/** A reactive form, returned by {@link createForm}. */
export class FormStore<S extends Schema.Top, A = S["Type"], Message = unknown> {
  /** The reactive form data — bind inputs to its fields. */
  data: A = $state()!;
  /** The current nested error tree, typed to the form data's shape. */
  errors: TypedFormErrors<A> = $state(noErrors as TypedFormErrors<A>);
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

  /** The values sent by the last submission (for revert / changed-since-submit). */
  #lastSubmitted: A | undefined = $state();
  /** Per-field touched flags, keyed by {@link Path.toString}. Drives `onBlur` display. */
  #touched: Record<string, boolean> = $state({});

  readonly id: string;
  readonly #initial: A;
  readonly #options: FormOptions<S, A, Message>;
  readonly #mode: Mode.ParsedMode;
  readonly #attachmentKey = createAttachmentKey();
  #autoSubmitNode: HTMLFormElement | undefined;
  #validateTimer: ReturnType<typeof setTimeout> | undefined;

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

  constructor(initial: FormState<A, Message>, options: FormOptions<S, A, Message> = {}) {
    this.id = initial.id;
    this.#initial = structuredClone(initial.data);
    this.#options = options;
    this.#mode = Mode.parse(options.mode);
    this.data = structuredClone(initial.data);
    this.errors = initial.errors as TypedFormErrors<A>;
    this.message = initial.message;
    this.constraints = initial.constraints ?? {};
    this.posted = initial.posted;
    this.valid = initial.valid;
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
    return getError(this.errors as FormErrors, path) ?? [];
  }

  /** Re-validate the whole form against the schema (if one was supplied). */
  validate(): boolean {
    if (!this.#options.schema) return this.valid;
    this.errors = validateData(
      this.#options.schema,
      this.data,
      this.#options.validationFormat,
    ) as TypedFormErrors<A>;
    this.valid = Object.keys(this.errors).length === 0;
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
   * Handle a field losing focus: mark it touched, and — in `onBlur` mode —
   * validate the form (auto-submitting if configured and something changed
   * since the last submit).
   */
  handleBlur(path: FormPath): void {
    this.setTouched(path, true);
    if (this.#mode.validation === "onBlur") {
      this.validate();
      if (this.#mode.autoSubmit && this.valid && this.#hasUnsubmittedChanges()) this.#autoSubmit();
    }
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

  /** Append an item to the array at `path` (a blank item is derived when omitted). */
  append(path: FormPath, value?: unknown): void {
    const current = (getAt(this.data, path) ?? []) as readonly unknown[];
    const item = value !== undefined ? value : this.#defaultItem(path);
    this.data = setAt(this.data, path, [...current, item]);
  }

  /** Remove the item at `index` from the array at `path`. */
  removeItem(path: FormPath, index: number): void {
    const current = (getAt(this.data, path) ?? []) as readonly unknown[];
    this.data = setAt(
      this.data,
      path,
      current.filter((_, i) => i !== index),
    );
  }

  /** Swap two items in the array at `path`. */
  swap(path: FormPath, indexA: number, indexB: number): void {
    const current = (getAt(this.data, path) ?? []) as readonly unknown[];
    if (!inRange(indexA, current.length) || !inRange(indexB, current.length) || indexA === indexB) {
      return;
    }
    const next = [...current];
    [next[indexA], next[indexB]] = [next[indexB], next[indexA]];
    this.data = setAt(this.data, path, next);
  }

  /** Move the item at `from` to `to` within the array at `path`. */
  move(path: FormPath, from: number, to: number): void {
    const current = (getAt(this.data, path) ?? []) as readonly unknown[];
    if (!inRange(from, current.length) || to < 0 || to >= current.length || from === to) return;
    const next = [...current];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    this.data = setAt(this.data, path, next);
  }

  /** Revert `data` to the values sent by the last submission (no-op before any submit). */
  revertToLastSubmit(): void {
    if (this.#lastSubmitted === undefined) return;
    this.data = structuredClone(this.#lastSubmitted);
    this.errors = noErrors as TypedFormErrors<A>;
  }

  /** Derive a blank item for the array field at a top-level `path`, else `""`. */
  #defaultItem(path: FormPath): unknown {
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

  /** Reset `data`, `errors`, and `message` back to the seeded values. */
  reset(): void {
    this.data = structuredClone(this.#initial);
    this.errors = noErrors as TypedFormErrors<A>;
    this.message = undefined;
    this.valid = false;
    this.posted = false;
    this.#touched = {};
    this.#lastSubmitted = undefined;
  }

  /** A serialisable snapshot for SvelteKit's `snapshot` capture/restore. */
  capture(): FormState<A, Message> {
    return {
      id: this.id,
      valid: this.valid,
      posted: this.posted,
      data: structuredClone(this.data),
      errors: this.errors as FormErrors,
      message: this.message,
      constraints: this.constraints,
    };
  }

  /** Restore from a {@link capture} snapshot. */
  restore(snapshot: FormState<A, Message>): void {
    this.data = structuredClone(snapshot.data);
    this.errors = snapshot.errors as TypedFormErrors<A>;
    this.message = snapshot.message;
    this.valid = snapshot.valid;
    this.posted = snapshot.posted;
  }

  #applyUpdate(update: FormUpdate<A, Message>, result: FormActionResult<A, Message>): void {
    this.#options.onUpdate?.({ update, result });
    if (update.redirect !== undefined) {
      if (this.#options.onRedirect) this.#options.onRedirect({ location: update.redirect });
      else if (typeof window !== "undefined") window.location.assign(update.redirect);
      return;
    }
    if (update.error !== undefined) {
      this.#options.onError?.({ error: update.error });
      return;
    }
    if (update.data !== undefined) {
      if (this.#options.resetForm && update.valid) {
        this.data = structuredClone(this.#initial);
      } else if (!this.#mode.autoSubmit) {
        this.data = update.data;
      }
      // An auto-submitting (live-save) form keeps its local data as the source
      // of truth: adopting the server's echo would discard keystrokes made
      // during the round-trip and, when the echo isn't byte-identical (a
      // trimmed or server-stamped field), retrigger the change watcher — an
      // extra submit, or an endless loop for a non-idempotent echo.
    }
    if (update.errors !== undefined) this.errors = update.errors as TypedFormErrors<A>;
    this.message = update.message;
    if (update.valid !== undefined) this.valid = update.valid;
    this.posted = true;
    this.#options.onUpdated?.({
      form: { data: this.data, errors: this.errors as FormErrors, valid: this.valid },
    });
  }

  async #runSubmit(node: HTMLFormElement): Promise<void> {
    const formData = new FormData(node);
    let cancelled = false;
    let resolved: FormActionResult<A, Message> | undefined;
    await this.#options.onSubmit?.({
      data: this.data,
      formData,
      form: node,
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
    this.#lastSubmitted = structuredClone(this.data);

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
      void this.#runSubmit(node);
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

    // In `onChange` mode, re-validate (and maybe auto-submit) whenever the data
    // changes — but not on the pristine initial render. An effect root gives us
    // explicit teardown alongside the DOM listeners.
    let stopWatching: (() => void) | undefined;
    if (this.#mode.validation === "onChange") {
      stopWatching = $effect.root(() => {
        $effect(() => {
          // Establish a deep dependency on the data tree.
          $state.snapshot(this.data);
          if (this.isTainted || this.posted) this.#scheduleValidation();
        });
      });
    }

    return {
      destroy: () => {
        node.removeEventListener("submit", handleSubmit);
        if (typeof window !== "undefined") window.removeEventListener("beforeunload", beforeUnload);
        stopWatching?.();
        clearTimeout(this.#validateTimer);
        if (this.#autoSubmitNode === node) this.#autoSubmitNode = undefined;
      },
    };
  };

  /** Attachment form of {@link FormStore.enhance} for {@link FormStore.props}. */
  readonly #enhanceAttachment = (node: Element): (() => void) =>
    this.enhance(node as HTMLFormElement).destroy;

  /** Build a {@link FormData} body from the current data (SPA / manual submit). */
  toFormData(): FormData {
    return objectToFormData(this.data);
  }
}

/** A schema plus its blank-form defaults — what {@link createForm} wraps `makeForm` over. */
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
  Message
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
 *   are all derived from the builder (client validation is wired automatically);
 * - `{ schema, defaults }` — seed a blank form (wrapping the core's `makeForm`);
 * - a server-produced {@link FormState} — hydrate from it (schema in `options`).
 */
export function createForm<TFields extends Field.FieldsRecord, R, Message = unknown>(
  builder: FormBuilder.FormBuilder<TFields, R>,
  options?: FormBuilderOptions<TFields, R, Message>,
): FormStore<BuiltSchema<TFields, R>, Field.EncodedFromFields<TFields>, Message>;
export function createForm<S extends Schema.Top, Message = unknown>(
  seed: FormSeed<S>,
  options?: FormOptions<S, S["Type"], Message>,
): FormStore<S, S["Type"], Message>;
export function createForm<S extends Schema.Top, A = S["Type"], Message = unknown>(
  initial: FormState<A, Message>,
  options: FormOptions<S, A, Message>,
): FormStore<S, A, Message>;
export function createForm(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  source: FormBuilder.FormBuilder<any, any> | FormSeed<Schema.Top> | FormState<unknown, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options: FormOptions<Schema.Top, any, any> & {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    defaults?: any;
    id?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): FormStore<Schema.Top, any, any> {
  if (FormBuilder.isFormBuilder(source)) {
    const schema = FormBuilder.buildSchema(source) as Schema.Top;
    const form = Form.fromBuilder(source, {
      ...(options.defaults !== undefined ? { defaults: options.defaults as never } : {}),
      ...(options.id !== undefined ? { id: options.id } : {}),
    });
    return new FormStore(form.empty(), { ...options, schema, fields: source.fields });
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
