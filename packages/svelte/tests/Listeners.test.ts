import { describe, expect, it } from "vite-plus/test";
import { changeEvents, dispatchChange, type FormListeners } from "../src/Listeners.ts";

describe("changeEvents", () => {
  it("is empty when nothing changed", () => {
    expect(changeEvents({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it("reports a changed scalar leaf with its new value", () => {
    expect(changeEvents({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual([{ path: ["b"], value: 3 }]);
  });

  it("reports nested object leaves", () => {
    expect(changeEvents({ author: { name: "Ada" } }, { author: { name: "Bob" } })).toEqual([
      { path: ["author", "name"], value: "Bob" },
    ]);
  });

  it("reports array elements by numeric index", () => {
    expect(changeEvents({ tags: ["a"] }, { tags: ["a", "b"] })).toEqual([
      { path: ["tags", 1], value: "b" },
    ]);
  });

  it("reports multiple changed leaves in one diff", () => {
    const events = changeEvents({ a: 1, b: 1 }, { a: 2, b: 2 });
    expect(events).toHaveLength(2);
    expect(events).toContainEqual({ path: ["a"], value: 2 });
    expect(events).toContainEqual({ path: ["b"], value: 2 });
  });
});

describe("dispatchChange", () => {
  it("is a no-op with no listeners configured", () => {
    expect(() => dispatchChange({ a: 1 }, { a: 2 }, undefined)).not.toThrow();
  });

  it("calls the form-level onChange once per changed leaf, naming the path", () => {
    const seen: unknown[] = [];
    const listeners: FormListeners = { onChange: (input) => seen.push(input.path) };
    dispatchChange({ a: 1, b: 1 }, { a: 2, b: 2 }, listeners);
    expect(seen).toContainEqual(["a"]);
    expect(seen).toContainEqual(["b"]);
  });

  it("calls a matching field listener with the path and new value", () => {
    const calls: Array<{ path: unknown; value: unknown }> = [];
    const listeners: FormListeners = {
      fields: { "author.name": { onChange: (input) => calls.push(input) } },
    };
    dispatchChange({ author: { name: "Ada" } }, { author: { name: "Bob" } }, listeners);
    expect(calls).toEqual([{ path: ["author", "name"], value: "Bob" }]);
  });

  it("does not call a field listener for a field that didn't change", () => {
    const calls: unknown[] = [];
    const listeners: FormListeners = {
      fields: { untouched: { onChange: (input) => calls.push(input) } },
    };
    dispatchChange({ untouched: 1, changed: 1 }, { untouched: 1, changed: 2 }, listeners);
    expect(calls).toEqual([]);
  });

  it("keys array-element field listeners with bracket notation", () => {
    const calls: unknown[] = [];
    const listeners: FormListeners = {
      fields: { "tags[0]": { onChange: (input) => calls.push(input) } },
    };
    dispatchChange({ tags: ["a"] }, { tags: ["b"] }, listeners);
    expect(calls).toEqual([{ path: ["tags", 0], value: "b" }]);
  });

  describe("linked-fields recipe: country change resets province without looping", () => {
    it("only re-fires listeners for paths that changed in each transition", () => {
      const countryChanges: unknown[] = [];
      const provinceChanges: unknown[] = [];
      let current: { country: string; province: string } = { country: "US", province: "CA" };
      const listeners: FormListeners = {
        fields: {
          country: {
            onChange: (input) => {
              countryChanges.push(input.value);
              // The recipe: switching country resets the now-invalid province.
              current = { ...current, province: "" };
            },
          },
          province: { onChange: (input) => provinceChanges.push(input.value) },
        },
      };

      // Pass 1: the user changes the country — `current` already reflects
      // that edit (the store's `data` is mutated before its watcher next
      // runs), diffed against `previous`, the snapshot from before the edit.
      // `afterUserEdit` pins the value actually diffed, since the listener
      // reassigns `current` again as a side effect of this call.
      let previous = current;
      current = { ...current, country: "CA" };
      const afterUserEdit = current;
      dispatchChange(previous, afterUserEdit, listeners);
      previous = afterUserEdit;

      // The listener above mutated `current` (province reset) as a further
      // side effect of pass 1, which is what re-triggers the store's watcher
      // for a second pass — diffed against `previous` (the snapshot pass 1
      // just produced), not the form's original values.
      dispatchChange(previous, current, listeners);
      previous = current;

      // A third pass sees no further change, so nothing fires again.
      dispatchChange(previous, current, listeners);

      expect(countryChanges).toEqual(["CA"]);
      expect(provinceChanges).toEqual([""]);
    });
  });
});
