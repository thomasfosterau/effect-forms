import { describe, expect, it } from "vite-plus/test";
import { fromString, getAt, isUnder, setAt, toString } from "../src/Path.ts";
import type { FieldPath, PathValue } from "../src/Path.ts";

describe("Path.getAt", () => {
  const data = { author: { name: "Ada" }, tags: ["a", "b"] };

  it("reads nested object and array values", () => {
    expect(getAt(data, ["author", "name"])).toBe("Ada");
    expect(getAt(data, ["tags", 1])).toBe("b");
  });

  it("returns the root for the empty path", () => {
    expect(getAt(data, [])).toBe(data);
  });

  it("returns undefined for missing / non-object segments", () => {
    expect(getAt(data, ["author", "missing"])).toBeUndefined();
    expect(getAt(data, ["author", "name", "deeper"])).toBeUndefined();
  });
});

describe("Path.setAt", () => {
  it("returns a new tree with the value replaced, without mutating", () => {
    const data = { author: { name: "Ada" }, tags: ["a", "b"] };
    const next = setAt(data, ["author", "name"], "Bob");
    expect(next).toEqual({ author: { name: "Bob" }, tags: ["a", "b"] });
    expect(data.author.name).toBe("Ada"); // original untouched
    expect(next.tags).toBe(data.tags); // structural sharing of untouched branches
  });

  it("replaces an array element", () => {
    const data = { tags: ["a", "b"] };
    expect(setAt(data, ["tags", 0], "z")).toEqual({ tags: ["z", "b"] });
  });

  it("creates missing containers (array for numeric segments, object otherwise)", () => {
    expect(setAt({}, ["a", "b"], 1)).toEqual({ a: { b: 1 } });
    expect(setAt({}, ["a", 0], 1)).toEqual({ a: [1] });
  });

  it("returns the value for the empty path", () => {
    expect(setAt({ a: 1 }, [], 42)).toBe(42);
  });
});

describe("Path.isUnder", () => {
  it("matches a path against itself and its descendants", () => {
    expect(isUnder(["a"], ["a"])).toBe(true);
    expect(isUnder(["a", "b"], ["a"])).toBe(true);
    expect(isUnder(["a", 0, "b"], ["a", 0])).toBe(true);
    expect(isUnder(["a"], ["a", "b"])).toBe(false);
    expect(isUnder(["b"], ["a"])).toBe(false);
  });
});

describe("Path.toString / fromString", () => {
  it("round-trips array and object segments", () => {
    expect(toString(["tags", 0])).toBe("tags[0]");
    expect(toString(["author", "name"])).toBe("author.name");
    expect(fromString("tags[0]")).toEqual(["tags", 0]);
    expect(fromString("author.name")).toEqual(["author", "name"]);
  });
});

// Type-level assertions for `FieldPath` / `PathValue` (#756): a mistyped
// segment or wrong leaf type must be a compile error. Encoded as assignability
// checks (the models package's `expectTypeOf`-style pattern) that break the
// build if the projection ever drifts — there is nothing to assert at runtime.
describe("Path.FieldPath / Path.PathValue", () => {
  interface Item {
    readonly label: string;
  }
  interface Data {
    readonly title: string;
    readonly author: { readonly name: string; readonly bio?: string };
    readonly tags: readonly string[];
    readonly items: readonly Item[];
  }

  it("accepts every valid deep path and rejects invalid ones", () => {
    const scalar: FieldPath<Data> = "title";
    const nested: FieldPath<Data> = "author.name";
    const optionalNested: FieldPath<Data> = "author.bio";
    const arrayIndex: FieldPath<Data> = "tags[0]";
    const arrayItemField: FieldPath<Data> = "items[0].label";
    // @ts-expect-error -- "titel" is not a key of Data
    const typo: FieldPath<Data> = "titel";
    // @ts-expect-error -- "author.missing" is not a key of Data["author"]
    const missingNested: FieldPath<Data> = "author.missing";
    void [scalar, nested, optionalNested, arrayIndex, arrayItemField, typo, missingNested];
    expect(true).toBe(true);
  });

  it("resolves the leaf type at a path", () => {
    const title: PathValue<Data, "title"> = "hello";
    const name: PathValue<Data, "author.name"> = "Ada";
    const tag: PathValue<Data, "tags[0]"> = "a";
    const label: PathValue<Data, "items[0].label"> = "x";
    // @ts-expect-error -- the leaf at "title" is `string`, not `number`
    const wrongType: PathValue<Data, "title"> = 1;
    void [title, name, tag, label, wrongType];
    expect(true).toBe(true);
  });
});
