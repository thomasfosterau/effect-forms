/**
 * `enhanceForm` against a stand-in `$app/forms` (see `app-forms.stub.ts`).
 */
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { applyAction, enhanced } from "./app-forms.stub.ts";
import { enhanceForm } from "../../src/kit/index.ts";

// The two members `enhanceForm` touches: `submitting`, and (through
// `applyActionResult`) `setServerState`.
const fakeStore = () => ({ submitting: false, setServerState: vi.fn() });

const attach = (store: ReturnType<typeof fakeStore>) => {
  // oxlint-disable-next-line typescript/no-explicit-any -- a structural stand-in for the rune store
  const props = enhanceForm(store as any);
  const [key] = Object.getOwnPropertySymbols(props);
  const node = {} as HTMLFormElement;
  const destroy = props[key!]!(node);
  const { submit } = enhanced.at(-1)!;
  return { props, node, destroy, submit };
};

beforeEach(() => {
  enhanced.length = 0;
  applyAction.mockClear();
});

describe("enhanceForm", () => {
  it("is a POST form whose attachment enhances the node", () => {
    const { props, node, destroy } = attach(fakeStore());
    expect(props.method).toBe("post");
    expect(enhanced).toHaveLength(1);
    expect(enhanced[0]!.node).toBe(node);
    expect(destroy).toBeTypeOf("function");
  });

  it("flips submitting and applies a validation failure back to the store", async () => {
    const store = fakeStore();
    const { submit } = attach(store);
    const after = submit({}) as (input: unknown) => Promise<void>;
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
    const after = submit({}) as (input: unknown) => Promise<void>;
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
