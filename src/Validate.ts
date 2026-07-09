/**
 * @copyright Thomas Foster
 *
 * Low-level validation helpers — decode a value through a schema and get back
 * the {@link FormErrors} tree (or the list of {@link FormIssue}s) instead of a
 * raised failure. `Form.make` is the high-level entry; these are for ad
 * hoc field- or value-level validation (e.g. a Svelte client validating a
 * single field on blur).
 *
 * The second half of the module is per-field validators: {@link
 * SyncFieldValidator} / {@link AsyncFieldValidator} (bundled as {@link
 * FieldValidators}) are the framework-neutral shape a reactive store attaches
 * to one field, mirroring TanStack Form's `validators.onChange(Async)` /
 * `onBlur(Async)`. {@link runSyncFieldValidator} runs one synchronously;
 * {@link runAsyncFieldValidator} builds the debounced Effect an async one
 * runs as — the store is responsible for forking it into a fiber per field
 * and interrupting the previous fiber on every new run (see that function's
 * docs for why that alone gives debounce + "latest wins" cancellation).
 *
 * @module effect-forms/Validate
 */

import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import * as SchemaParser from "effect/SchemaParser";
import { type FormErrors, issuesToErrors } from "./Errors.ts";
import {
  filterOutputToFormIssues,
  type FormIssue,
  type LeafFormatter,
  schemaIssuesToFormIssues,
} from "./Issues.ts";

/** The outcome of validating a value against a schema. */
export type ValidationResult<A> =
  | { readonly valid: true; readonly data: A }
  | {
      readonly valid: false;
      readonly errors: FormErrors;
      readonly issues: ReadonlyArray<FormIssue>;
    };

/**
 * Decode `input` through `schema`, returning a {@link ValidationResult} on the
 * success channel (decode failures become `valid: false`, not an Effect
 * failure). Decoding-service requirements propagate on the `R` channel.
 */
export function validateValue<S extends Schema.Top>(
  schema: S,
  input: unknown,
  format?: LeafFormatter,
): Effect.Effect<ValidationResult<S["Type"]>, never, S["DecodingServices"]> {
  return SchemaParser.decodeUnknownEffect(schema, { errors: "all" })(input).pipe(
    Effect.matchEffect({
      onSuccess: (data): Effect.Effect<ValidationResult<S["Type"]>> =>
        Effect.succeed({ valid: true, data }),
      onFailure: (issue): Effect.Effect<ValidationResult<S["Type"]>> => {
        const issues = schemaIssuesToFormIssues(issue, format);
        return Effect.succeed({ valid: false, errors: issuesToErrors(issues), issues });
      },
    }),
  );
}

/**
 * Synchronous {@link validateValue} for schemas with no decoding-service
 * requirements (`R = never`) and no async decoding — the common case for plain
 * form schemas. {@link validateValue} never fails on the error channel, so
 * running it with {@link Effect.runSync} is total.
 */
export function validateValueSync<S extends Schema.Top>(
  schema: S,
  input: unknown,
  format?: LeafFormatter,
): ValidationResult<S["Type"]> {
  // `validateValue` never fails on the error channel; the cast drops the
  // decoding-service requirement, which the caller asserts is `never` (the
  // common case for plain form schemas — a service-requiring schema must use
  // the async {@link validateValue}).
  return Effect.runSync(
    validateValue(schema, input, format) as Effect.Effect<ValidationResult<S["Type"]>>,
  );
}

/**
 * A synchronous per-field validator — TanStack Form's `validators.onChange` /
 * `onBlur` shape. Sees the field's decoded value and returns a {@link
 * Schema.FilterOutput} (`undefined` / `true` to pass, a message / issue /
 * list to fail), the same vocabulary a schema `check` or a {@link
 * module:effect-forms/FormBuilder} `refine` predicate uses.
 */
export type SyncFieldValidator<A> = (value: A) => Schema.FilterOutput;

/**
 * An asynchronous per-field validator — TanStack Form's `onChangeAsync` /
 * `onBlurAsync`. An Effect (not a `Promise`) so its `R` channel can demand
 * services (an API client, a cache) the way a {@link
 * module:effect-forms/FormBuilder} `refineEffect` refinement does; a caller
 * running this client-side supplies `R` via a `Layer` / runtime, or keeps it
 * `never` for a plain `fetch`-based check.
 */
export type AsyncFieldValidator<A, R = never> = (
  value: A,
) => Effect.Effect<Schema.FilterOutput, never, R>;

/**
 * The validators one field declares, mirroring TanStack Form's per-field
 * `validators` option. `asyncDebounceMs` (default `0`, meaning no debounce)
 * governs both async variants; see {@link runAsyncFieldValidator} for how the
 * debounce and cancellation actually work.
 */
export interface FieldValidators<A, R = never> {
  readonly onChange?: SyncFieldValidator<A>;
  readonly onBlur?: SyncFieldValidator<A>;
  readonly onChangeAsync?: AsyncFieldValidator<A, R>;
  readonly onBlurAsync?: AsyncFieldValidator<A, R>;
  readonly asyncDebounceMs?: number;
}

/**
 * Run a {@link SyncFieldValidator}, folding its {@link Schema.FilterOutput}
 * into {@link FormIssue}s (empty on success). Total — a sync field validator
 * cannot fail the Effect error channel.
 */
export function runSyncFieldValidator<A>(
  validator: SyncFieldValidator<A>,
  value: A,
): ReadonlyArray<FormIssue> {
  return filterOutputToFormIssues(validator(value));
}

/**
 * Build the Effect an {@link AsyncFieldValidator} run is: sleep `debounceMs`
 * (a no-op at `0`, the default), then run `validator` and fold its output
 * into {@link FormIssue}s.
 *
 * The debounce is a plain {@link Effect.sleep}, so it rides Effect's `Clock`
 * — deterministic and instantly-advanceable under `TestClock` in tests, real
 * time otherwise (no `setTimeout` bookkeeping for a caller to manage).
 * "Latest wins" falls out of ordinary fiber interruption: a caller re-running
 * this on every keystroke forks a fresh fiber per call and interrupts the
 * previous one before forking the next — interrupting mid-sleep skips the
 * validator entirely (a true debounce, not just a discarded stale result),
 * and interrupting mid-validator aborts whatever the validator was doing
 * (e.g. an in-flight `fetch` wrapped as an Effect).
 */
export function runAsyncFieldValidator<A, R>(
  validator: AsyncFieldValidator<A, R>,
  value: A,
  debounceMs = 0,
): Effect.Effect<ReadonlyArray<FormIssue>, never, R> {
  return Effect.gen(function* () {
    if (debounceMs > 0) yield* Effect.sleep(Duration.millis(debounceMs));
    const output = yield* validator(value);
    return filterOutputToFormIssues(output);
  });
}

/** Which trigger a {@link FieldValidators} sync/async pair reacts to. */
export type FieldTrigger = "change" | "blur";

/** The validator(s) (if any) that apply for one field trigger — see {@link resolveFieldTrigger}. */
export interface ResolvedFieldTrigger<A, R = never> {
  readonly sync: SyncFieldValidator<A> | undefined;
  readonly async: AsyncFieldValidator<A, R> | undefined;
  readonly asyncDebounceMs: number;
}

/**
 * Pick `validators`' sync/async pair for `trigger` (TanStack's `onChange` /
 * `onBlur` vs `onChangeAsync` / `onBlurAsync`). A reactive store calls this
 * once per trigger instead of repeating the trigger ternary at each call
 * site — the pure decision half of what {@link module:effect-forms-svelte/FormStore}'s
 * field-trigger dispatch runs.
 */
export function resolveFieldTrigger<A, R = never>(
  validators: FieldValidators<A, R> | undefined,
  trigger: FieldTrigger,
): ResolvedFieldTrigger<A, R> {
  return {
    sync: trigger === "change" ? validators?.onChange : validators?.onBlur,
    async: trigger === "change" ? validators?.onChangeAsync : validators?.onBlurAsync,
    asyncDebounceMs: validators?.asyncDebounceMs ?? 0,
  };
}
