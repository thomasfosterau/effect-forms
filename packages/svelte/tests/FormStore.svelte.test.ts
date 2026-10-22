// @vitest-environment happy-dom
/**
 * Pins the submitter-aware enhanced submit path (issue #753): a multi-button
 * form (`<button name="intent" value="save">` vs `value="publish">`) must post
 * the clicked button's name/value, matching native `new FormData(form,
 * submitter)` / no-JS POST semantics — and the button-less auto-submit path
 * (`onChange`/`onBlur` with `autoSubmit`) must keep posting without one.
 *
 * `FormStore.svelte.ts` is otherwise only type-checked (by `vp check` and by
 * svelte-check, the `check` task), not unit-tested — this file only exercises
 * the submit body / event wiring, not the rest of the store (validation, field
 * arrays, snapshots, …). Importing the store here through the `svelte()`
 * plugin is also what catches its rune compile errors (`state_invalid_export`,
 * …), which neither type-checker reports.
 * `.svelte.ts` runes need the Svelte compiler, hence `.svelte.test.ts` (see
 * `vite.config.ts`'s `svelte()` plugin) and a DOM (`happy-dom`, scoped to this
 * file via the `@vitest-environment` docblock) for `HTMLFormElement`/`FormData`.
 *
 * @module tests/FormStore.svelte
 */

import { Constraints, Result, State } from "@thomasfosterau/effect-forms";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { assert, describe, expect, it } from "vite-plus/test";
import { createForm } from "../src/FormStore.svelte.ts";

const { success } = Result;
const makeFormState = State.make;

const ActionForm = Schema.Struct({ title: Schema.String });

/** The posted `title`, which the form's text input always sends as a string. */
const titleOf = (body: FormData): string => {
  const title = body.get("title");
  assert(Predicate.isString(title), "expected a string title in the posted body");
  return title;
};

/** A multi-action form: one text field, two submit buttons sharing a name. */
function buildMultiButtonForm() {
  const node = document.createElement("form");

  const titleInput = document.createElement("input");
  titleInput.name = "title";
  titleInput.value = "Hello";
  node.append(titleInput);

  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.name = "intent";
  saveButton.value = "save";
  node.append(saveButton);

  const publishButton = document.createElement("button");
  publishButton.type = "submit";
  publishButton.name = "intent";
  publishButton.value = "publish";
  node.append(publishButton);

  document.body.append(node);
  return { node, titleInput, saveButton, publishButton };
}

describe("enhanced submit — clicked-button submitter", () => {
  it("folds the clicked button's name/value into the posted body", async () => {
    const { node, publishButton } = buildMultiButtonForm();
    const bodies: FormData[] = [];
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    const store = createForm(
      { schema: ActionForm, defaults: { title: "" } },
      {
        submit: async (body) => {
          bodies.push(body);
          return success(makeFormState({ title: titleOf(body) }));
        },
        onResult: () => resolveDone(),
      },
    );
    store.enhance(node);

    node.requestSubmit(publishButton);
    await done;

    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.get("intent")).toBe("publish");
    expect(bodies[0]?.get("title")).toBe("Hello");
  });

  it("posts the other button's value when that one is clicked instead", async () => {
    const { node, saveButton } = buildMultiButtonForm();
    const bodies: FormData[] = [];
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    const store = createForm(
      { schema: ActionForm, defaults: { title: "" } },
      {
        submit: async (body) => {
          bodies.push(body);
          return success(makeFormState({ title: titleOf(body) }));
        },
        onResult: () => resolveDone(),
      },
    );
    store.enhance(node);

    node.requestSubmit(saveButton);
    await done;

    expect(bodies[0]?.get("intent")).toBe("save");
  });

  it("exposes the clicked button as Submission.submitter", async () => {
    const { node, publishButton } = buildMultiButtonForm();
    let submitter: HTMLElement | null | undefined;
    let resolveOnSubmit!: () => void;
    const seen = new Promise<void>((resolve) => {
      resolveOnSubmit = resolve;
    });

    const store = createForm(
      { schema: ActionForm, defaults: { title: "" } },
      {
        onSubmit: ({ submitter: s }) => {
          submitter = s;
          resolveOnSubmit();
        },
        submit: async () => success(makeFormState({ title: "" })),
      },
    );
    store.enhance(node);

    node.requestSubmit(publishButton);
    await seen;

    expect(submitter).toBe(publishButton);
  });
});

describe("auto-submit — no submitter", () => {
  it("posts without a button value and reports a null submitter", async () => {
    const { node, titleInput } = buildMultiButtonForm();
    const bodies: FormData[] = [];
    let submitter: HTMLElement | null | undefined;
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    const store = createForm(
      { schema: ActionForm, defaults: { title: "" } },
      {
        mode: { validation: "onBlur", autoSubmit: true },
        onSubmit: ({ submitter: s }) => {
          submitter = s;
        },
        submit: async (body) => {
          bodies.push(body);
          return success(makeFormState({ title: titleOf(body) }));
        },
        onResult: () => resolveDone(),
      },
    );
    store.enhance(node);

    // The DOM input is what `FormData` reads; the store's `data` is what taint
    // detection reads — both need the change for `handleBlur`'s autoSubmit
    // condition to fire and for the posted body to reflect it.
    titleInput.value = "changed";
    // SAFETY: `data`'s public type is the schema's (readonly) decoded shape; the
    // underlying `$state` is mutable at runtime regardless — this simulates a
    // live input change the way taint detection observes it.
    (store.data as { title: string }).title = "changed";
    store.handleBlur(["title"]);
    await done;

    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.get("intent")).toBeNull();
    expect(bodies[0]?.get("title")).toBe("changed");
    expect(submitter).toBeNull();
  });
});

describe("setValue on the deeply-proxied store data", () => {
  it("does not throw DataCloneError and keeps the value + dirty tracking (regression)", () => {
    // `data` is a deep `$state` proxy; every path-addressed write re-snapshots
    // `#previousData` for diffing. `structuredClone` rejects proxies, so the
    // snapshot must go through `$state.snapshot` (the #detachedData helper) —
    // this threw `DataCloneError` before the fix, breaking every
    // `form.field(...).value = …` write (FieldHandle setters, widget bridges).
    const store = createForm({
      schema: Schema.Struct({ title: Schema.optional(Schema.String) }),
      defaults: { title: "" },
    });
    expect(() => store.setValue(["title"], "typed")).not.toThrow();
    expect(store.valueAt(["title"])).toBe("typed");
    expect(store.isDirtyAt(["title"])).toBe(true);
    expect(() => store.setValue(["title"], "typed more")).not.toThrow();
    expect(store.valueAt(["title"])).toBe("typed more");
  });
});

describe("constraints — createForm overload symmetry (issue #1330)", () => {
  const Constrained = Schema.Struct({
    title: Schema.String.check(Schema.isMinLength(2), Schema.isMaxLength(50)),
    subtitle: Schema.optional(Schema.String),
  });

  it("derives identical constraints from the { schema, defaults } and FormState-hydration overloads", () => {
    const seeded = createForm({ schema: Constrained, defaults: { title: "", subtitle: "" } });
    const hydrated = createForm(State.make({ title: "", subtitle: "" }), {
      schema: Constrained,
    });

    const expected = Constraints.constraintsFromSchema(Constrained);
    expect(seeded.constraints).toEqual(expected);
    expect(hydrated.constraints).toEqual(expected);
    expect(hydrated.constraints).toEqual(seeded.constraints);
  });

  it("prefers a hydrated FormState's own constraints over deriving from options.schema", () => {
    const explicit: Constraints.InputConstraints = { title: { required: false } };
    const hydrated = createForm(
      State.make({ title: "", subtitle: "" }, { constraints: explicit }),
      { schema: Constrained },
    );

    expect(hydrated.constraints).toEqual(explicit);
  });
});
