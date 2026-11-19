/**
 * The pure half of field and form listeners (TanStack Form's model):
 * {@link changeEvents} diffs two data snapshots into changed leaf paths, and
 * {@link dispatchChange} fires the listeners for that diff. Diffing against the
 * immediately prior snapshot keeps a data-mutating listener from re-triggering
 * itself.
 *
 * @module effect-forms-svelte/Listeners
 */

import type { Issues } from "@thomasfosterau/effect-forms";
import { Path } from "@thomasfosterau/effect-forms";
import * as Arr from "effect/Array";
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
export function changeEvents<A extends Path.FormValue>(before: A, after: A): ListenerEvent[] {
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
export function dispatchChange<A extends Path.FormValue>(
  before: A,
  after: A,
  listeners?: FormListeners,
): void {
  if (!listeners) return;
  Arr.forEach(changeEvents(before, after), (event) => {
    listeners.onChange?.({ path: event.path, data: after });
    listeners.fields?.[Path.toString(event.path)]?.onChange?.({
      path: event.path,
      value: event.value,
    });
  });
}
