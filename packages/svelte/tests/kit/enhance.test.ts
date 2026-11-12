// @vitest-environment happy-dom
/**
 * `enhanceForm` against a stand-in `$app/forms` (see `app-forms.stub.ts`).
 */
import * as P from "effect/Predicate";
import * as Schema from "effect/Schema";
import { assert, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createForm } from "../../src/FormStore.svelte.ts";
import { applyAction, enhanced } from "./app-forms.stub.ts";
import { enhanceForm } from "../../src/kit/index.ts";

const Named = Schema.Struct({ name: Schema.String });

// A real rune store; `setServerState` is spied (and still runs) so a test can
// see what `applyActionResult` handed it.
const realStore = () => {
  const store = createForm({ schema: Named, defaults: { name: "" } });
  return { store, setServerState: vi.spyOn(store, "setServerState") };
};

/** The submit callback `enhanceForm` hands the stubbed `enhance`. */
type RecordedSubmit = (typeof enhanced)[number]["submit"];

/** The callback SvelteKit runs after the action returns (see `Enhance.ts`). */
type AfterSubmit = Exclude<Awaited<ReturnType<RecordedSubmit>>, void>;

type ActionOutcome = Parameters<AfterSubmit>[0]["result"];

/** The slice of SvelteKit's `page` state the default `update` writes: `page.form`. */
interface PageForm {
  form: unknown;
}

const attach = (store: ReturnType<typeof realStore>["store"]) => {
  const props = enhanceForm(store);
  const [key] = Object.getOwnPropertySymbols(props);
  assert.isDefined(key, "enhanceForm returns one attachment key");
  const attachment = props[key];
  assert.isDefined(attachment);
  const node = document.createElement("form");
  const destroy = attachment(node);
  const last = enhanced.at(-1);
  assert.isDefined(last, "the attachment calls the stubbed enhance");
  return { props, node, destroy, submit: last.submit };
};

/** Runs the recorded submit callback, returning the after-submit handler it hands back. */
const submitWith = async (submit: RecordedSubmit, node: HTMLFormElement): Promise<AfterSubmit> => {
  const after = await submit({
    action: new URL("https://example.test/"),
    formData: new FormData(node),
    formElement: node,
    controller: new AbortController(),
    submitter: null,
    cancel: () => {},
  });
  assert(P.isFunction(after), "enhanceForm's submit callback returns its after-submit handler");
  return after;
};

/** Runs the after-submit handler with `result` and a spied `update`. */
const finish = (
  after: AfterSubmit,
  node: HTMLFormElement,
  result: ActionOutcome,
  update: (options?: { reset?: boolean }) => Promise<void> = async () => {},
) =>
  after({
    formData: new FormData(node),
    formElement: node,
    action: new URL("https://example.test/"),
    result,
    update,
  });

beforeEach(() => {
  enhanced.length = 0;
  applyAction.mockClear();
});

describe("enhanceForm", () => {
  it("is a POST form whose attachment enhances the node", () => {
    const { store } = realStore();
    const { props, node, destroy } = attach(store);
    expect(props.method).toBe("post");
    expect(enhanced).toHaveLength(1);
    expect(enhanced[0]?.node).toBe(node);
    expect(destroy).toBeTypeOf("function");
  });

  it("flips submitting and applies a validation failure back to the store", async () => {
    const { store, setServerState } = realStore();
    const { submit, node } = attach(store);
    const after = await submitWith(submit, node);
    expect(store.submitting).toBe(true);

    const update = vi.fn(async () => {});
    await finish(
      after,
      node,
      {
        type: "failure",
        status: 422,
        location: "/",
        data: { form: { data: { name: "" }, errors: { name: ["Required"] } } },
      },
      update,
    );
    expect(store.submitting).toBe(false);
    expect(setServerState).toHaveBeenCalledWith({ name: "" }, { name: ["Required"] });
    // `update` still runs, so SvelteKit replaces `page.form` with this result.
    expect(update).toHaveBeenCalledWith({ reset: false });
    expect(applyAction).not.toHaveBeenCalled();
  });

  it("replaces a stale page.form message when a later submit fails validation (#146)", async () => {
    const { store, setServerState } = realStore();
    const { submit, node } = attach(store);
    // SvelteKit's default `update` applies the result: `page.form` becomes its `data`.
    const page: PageForm = { form: undefined };
    const updateFor = (result: ActionOutcome) => async () => {
      page.form = "data" in result ? result.data : undefined;
    };

    const fault: ActionOutcome = {
      type: "failure",
      status: 500,
      location: "/",
      data: { message: "boom" },
    };
    await finish(await submitWith(submit, node), node, fault, updateFor(fault));
    expect(page.form).toEqual({ message: "boom" });
    expect(setServerState).not.toHaveBeenCalled();

    const invalid: ActionOutcome = {
      type: "failure",
      status: 400,
      location: "/",
      data: { form: { data: { name: "" }, errors: { name: ["Required"] } } },
    };
    await finish(await submitWith(submit, node), node, invalid, updateFor(invalid));
    expect(setServerState).toHaveBeenCalledWith({ name: "" }, { name: ["Required"] });
    expect(page.form).toEqual(invalid.data);
    expect(page.form).not.toHaveProperty("message");
  });

  it("defers to SvelteKit for anything else, without resetting the form", async () => {
    const { store, setServerState } = realStore();
    const { submit, node } = attach(store);
    const after = await submitWith(submit, node);
    const update = vi.fn(async () => {});
    await finish(
      after,
      node,
      { type: "redirect", status: 303, location: "/organisations/org-1" },
      update,
    );
    expect(store.submitting).toBe(false);
    expect(update).toHaveBeenCalledWith({ reset: false });
    // `update` already applies the result; a second `applyAction` would apply it twice (#31).
    expect(applyAction).not.toHaveBeenCalled();
    expect(setServerState).not.toHaveBeenCalled();
  });
});
