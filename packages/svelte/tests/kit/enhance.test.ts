/**
 * `enhanceForm` against a stand-in `$app/forms` (see `app-forms.stub.ts`).
 */
import { assert, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { applyAction, enhanced } from "./app-forms.stub.ts";
import { enhanceForm } from "../../src/kit/index.ts";

// The two members `enhanceForm` touches: `submitting`, and (through
// `applyActionResult`) `setServerState`.
const fakeStore = () => ({ submitting: false, setServerState: vi.fn() });

/** The rune store `enhanceForm` accepts. */
type EnhancedStore = Parameters<typeof enhanceForm>[0];

/** The callback SvelteKit runs after the action returns (see `Enhance.ts`). */
type AfterSubmit = (input: {
  readonly result: object;
  readonly update: (options: { readonly reset: boolean }) => Promise<void> | void;
}) => Promise<void>;

/** The submit callback `enhanceForm` hands the stubbed `enhance`. */
type RecordedSubmit = (typeof enhanced)[number]["submit"];

const attach = (store: ReturnType<typeof fakeStore>) => {
  const touched: Pick<EnhancedStore, "submitting" | "setServerState"> = store;
  // SAFETY: a structural stand-in for the rune store — `enhanceForm` touches only
  // `submitting` and (through `applyActionResult`) `setServerState`.
  const props = enhanceForm(touched as EnhancedStore);
  const [key] = Object.getOwnPropertySymbols(props);
  assert.isDefined(key, "enhanceForm returns one attachment key");
  const attachment = props[key];
  assert.isDefined(attachment);
  // SAFETY: the stubbed `$app/forms` `enhance` only records the node; nothing reads it.
  const node = {} as HTMLFormElement;
  const destroy = attachment(node);
  const last = enhanced.at(-1);
  assert.isDefined(last, "the attachment calls the stubbed enhance");
  return { props, node, destroy, submit: last.submit };
};

/** Runs the recorded submit callback, returning the after-submit handler it hands back. */
const submitWith = (submit: RecordedSubmit): AfterSubmit =>
  // SAFETY: `enhanceForm`'s submit callback always returns its async after-submit handler.
  submit({}) as AfterSubmit;

beforeEach(() => {
  enhanced.length = 0;
  applyAction.mockClear();
});

describe("enhanceForm", () => {
  it("is a POST form whose attachment enhances the node", () => {
    const { props, node, destroy } = attach(fakeStore());
    expect(props.method).toBe("post");
    expect(enhanced).toHaveLength(1);
    expect(enhanced[0]?.node).toBe(node);
    expect(destroy).toBeTypeOf("function");
  });

  it("flips submitting and applies a validation failure back to the store", async () => {
    const store = fakeStore();
    const { submit } = attach(store);
    const after = submitWith(submit);
    expect(store.submitting).toBe(true);

    const update = vi.fn();
    await after({
      result: {
        type: "failure",
        data: { form: { data: { name: "" }, errors: { name: ["Required"] } } },
      },
      update,
    });
    expect(store.submitting).toBe(false);
    expect(store.setServerState).toHaveBeenCalledWith({ name: "" }, { name: ["Required"] });
    expect(update).not.toHaveBeenCalled();
    expect(applyAction).not.toHaveBeenCalled();
  });

  it("defers to SvelteKit for anything else, without resetting the form", async () => {
    const store = fakeStore();
    const { submit } = attach(store);
    const after = submitWith(submit);
    const result = { type: "redirect", status: 303, location: "/organisations/org-1" };
    const update = vi.fn(async () => {});
    await after({ result, update });
    expect(store.submitting).toBe(false);
    expect(update).toHaveBeenCalledWith({ reset: false });
    // `update` already applies the result; a second `applyAction` would apply it twice (#31).
    expect(applyAction).not.toHaveBeenCalled();
    expect(store.setServerState).not.toHaveBeenCalled();
  });
});
