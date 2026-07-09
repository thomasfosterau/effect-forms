// @vitest-environment happy-dom
/**
 * Pins the submitter-aware enhanced submit path (issue #753): a multi-button
 * form (`<button name="intent" value="save">` vs `value="publish">`) must post
 * the clicked button's name/value, matching native `new FormData(form,
 * submitter)` / no-JS POST semantics — and the button-less auto-submit path
 * (`onChange`/`onBlur` with `autoSubmit`) must keep posting without one.
 *
 * `FormStore.svelte.ts` is otherwise checked by `svelte-check`, not unit-tested
 * (see the package README) — this file only exercises the submit body / event
 * wiring, not the rest of the store (validation, field arrays, snapshots, …).
 * `.svelte.ts` runes need the Svelte compiler, hence `.svelte.test.ts` (see
 * `vite.config.ts`'s `svelte()` plugin) and a DOM (`happy-dom`, scoped to this
 * file via the `@vitest-environment` docblock) for `HTMLFormElement`/`FormData`.
 *
 * @module tests/FormStore.svelte
 */

import { Result, State } from "@thomasfosterau/effect-forms";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { createForm } from "../src/FormStore.svelte.ts";

const { success } = Result;
const makeFormState = State.make;

const ActionForm = Schema.Struct({ title: Schema.String });

/** A multi-action form: one text field, two submit buttons sharing a name. */
function buildMultiButtonForm(): {
  node: HTMLFormElement;
  titleInput: HTMLInputElement;
  saveButton: HTMLButtonElement;
  publishButton: HTMLButtonElement;
} {
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
          return success(makeFormState({ title: body.get("title") as string }));
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
          return success(makeFormState({ title: body.get("title") as string }));
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
          return success(makeFormState({ title: body.get("title") as string }));
        },
        onResult: () => resolveDone(),
      },
    );
    store.enhance(node);

    // The DOM input is what `FormData` reads; the store's `data` is what taint
    // detection reads — both need the change for `handleBlur`'s autoSubmit
    // condition to fire and for the posted body to reflect it.
    titleInput.value = "changed";
    store.data.title = "changed";
    store.handleBlur(["title"]);
    await done;

    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.get("intent")).toBeNull();
    expect(bodies[0]?.get("title")).toBe("changed");
    expect(submitter).toBeNull();
  });
});
