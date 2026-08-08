/**
 * @copyright Thomas Foster
 *
 * Field- and form-level listeners — side-effecting hooks that fire as the
 * form's data changes, independent of validation. The model is TanStack
 * Form's listeners guide: a field can react to its own `onChange` / `onBlur`
 * (optionally debounced), and the form as a whole can react to `onMount` and
 * to any change, told which path triggered it. The classic use is linked
 * fields — a country field's `onChange` resetting a dependent province field.
 *
 * This module is the pure half: {@link changeEvents} diffs two data
 * snapshots (reusing {@link module:effect-forms-svelte/Tainted}'s tree) into
 * the flat list of changed leaf paths + their new values, and
 * {@link dispatchChange} fires the configured listeners for that diff. Both
 * are synchronous and side-effect-free beyond invoking the caller's own
 * callbacks — no timers, no Svelte. The reactive store (`FormStore.svelte.ts`)
 * is the impure half: it re-derives the diff off its deep `$effect` watcher,
 * wraps each field listener in its own debounce timer, and owns `onBlur` /
 * `onMount` timing.
 *
 * Because {@link dispatchChange} only ever compares the *immediately prior*
 * snapshot against the current one (never the form's original values), a
 * listener that mutates data — like the linked-fields recipe — cannot
 * re-trigger itself: the watcher's next pass diffs against the mutation it
 * just produced, so only the fields that actually moved in *that* transition
 * fire again. See `Listeners.test.ts` for the two-pass trace.
 *
 * @module effect-forms-svelte/Listeners
 */

import type { Issues } from "@thomasfosterau/effect-forms";
import { Path } from "@thomasfosterau/effect-forms";
import type * as Duration from "effect/Duration";
import { computeTainted, taintedLeafPaths } from "./Tainted.ts";

type FormPath = Issues.FormPath;

/** One leaf that changed between two data snapshots. */
export interface ListenerEvent {
  /** The path to the changed leaf. */
  readonly path: FormPath;
  /** The leaf's value in the *later* snapshot. */
  readonly value: unknown;
}

/** A field-level listener pair, keyed by {@link Path.toString} in {@link FormListeners.fields}. */
export interface FieldListener {
  /** Called when this field's value changes (after `debounce`, if set). */
  readonly onChange?: (input: { readonly path: FormPath; readonly value: unknown }) => void;
  /** Called when this field is blurred (after `debounce`, if set). */
  readonly onBlur?: (input: { readonly path: FormPath; readonly value: unknown }) => void;
  /** Debounce applied to both callbacks above. No debounce when omitted. */
  readonly debounce?: Duration.Input;
}

/** Form-wide listener hooks, plus the field-keyed table. */
export interface FormListeners {
  /** Called once when the form mounts (i.e. when `enhance` attaches). */
  readonly onMount?: (input: { readonly data: unknown }) => void;
  /** Called for every changed leaf, naming which path triggered it. */
  readonly onChange?: (input: { readonly path: FormPath; readonly data: unknown }) => void;
  /** Field-level listeners, keyed by {@link Path.toString} (e.g. `"author.name"`, `"tags[0]"`). */
  readonly fields?: Record<string, FieldListener>;
}

/**
 * The leaf paths that changed from `before` to `after`, each with its new
 * value. Built on {@link computeTainted}, so the same rules apply: array
 * elements are diffed by index, and a container-vs-scalar kind change taints
 * the whole field rather than recursing.
 */
export function changeEvents(before: unknown, after: unknown): ListenerEvent[] {
  return taintedLeafPaths(computeTainted(before, after)).map((path) => ({
    path,
    value: Path.getAt(after, path),
  }));
}

/**
 * Fire the configured {@link FormListeners} for the transition from `before`
 * to `after`: the form-level `onChange` for every changed leaf, then that
 * leaf's field-level `onChange` if one is registered. Synchronous — debounce
 * is the caller's concern (see the module doc).
 */
export function dispatchChange(
  before: unknown,
  after: unknown,
  listeners: FormListeners | undefined,
): void {
  if (!listeners) return;
  for (const event of changeEvents(before, after)) {
    listeners.onChange?.({ path: event.path, data: after });
    listeners.fields?.[Path.toString(event.path)]?.onChange?.({
      path: event.path,
      value: event.value,
    });
  }
}
