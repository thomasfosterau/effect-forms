import { describe, expect, it } from "vite-plus/test";
import {
  clearAll,
  fromString,
  getAt,
  insertAt,
  isUnder,
  moveAt,
  remapIndex,
  remapKeyedRecord,
  removeAt,
  replaceAt,
  setAt,
  swapAt,
  toString,
} from "../src/Path.ts";
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

describe("Path index maps", () => {
  it("removeAt shifts later indices down and drops the removed one", () => {
    const map = removeAt(1);
    expect(map(0)).toBe(0);
    expect(map(1)).toBeNull();
    expect(map(2)).toBe(1);
  });

  it("insertAt shifts index and later up", () => {
    const map = insertAt(1);
    expect(map(0)).toBe(0);
    expect(map(1)).toBe(2);
    expect(map(2)).toBe(3);
  });

  it("swapAt swaps exactly the two indices", () => {
    const map = swapAt(0, 2);
    expect(map(0)).toBe(2);
    expect(map(2)).toBe(0);
    expect(map(1)).toBe(1);
  });

  it("moveAt shifts the range between from and to (forward)", () => {
    const map = moveAt(0, 2);
    expect(map(0)).toBe(2);
    expect(map(1)).toBe(0);
    expect(map(2)).toBe(1);
    expect(map(3)).toBe(3);
  });

  it("moveAt shifts the range between from and to (backward)", () => {
    const map = moveAt(2, 0);
    expect(map(2)).toBe(0);
    expect(map(0)).toBe(1);
    expect(map(1)).toBe(2);
    expect(map(3)).toBe(3);
  });

  it("replaceAt drops only the replaced index", () => {
    const map = replaceAt(1);
    expect(map(0)).toBe(0);
    expect(map(1)).toBeNull();
    expect(map(2)).toBe(2);
  });

  it("clearAll drops every index", () => {
    expect(clearAll(0)).toBeNull();
    expect(clearAll(5)).toBeNull();
  });
});

describe("Path.remapIndex", () => {
  it("passes through paths outside the array path unchanged", () => {
    expect(remapIndex(["title"], ["tags"], removeAt(0))).toEqual(["title"]);
  });

  it("passes through the array path itself (a whole-array message)", () => {
    expect(remapIndex(["tags"], ["tags"], removeAt(0))).toEqual(["tags"]);
  });

  it("passes through a non-numeric segment under the array path", () => {
    expect(remapIndex(["tags", "_errors"], ["tags"], removeAt(0))).toEqual(["tags", "_errors"]);
  });

  it("remaps the index segment and keeps the rest of the path", () => {
    expect(remapIndex(["tags", 2], ["tags"], removeAt(0))).toEqual(["tags", 1]);
    expect(remapIndex(["tags", 2, "name"], ["tags"], insertAt(0))).toEqual(["tags", 3, "name"]);
  });

  it("drops a path whose index maps to null", () => {
    expect(remapIndex(["tags", 0], ["tags"], removeAt(0))).toBeNull();
  });

  it("remaps a nested array under a struct path", () => {
    expect(remapIndex(["authors", 0, "emails", 2], ["authors", 0, "emails"], removeAt(0))).toEqual([
      "authors",
      0,
      "emails",
      1,
    ]);
  });
});

describe("Path.remapKeyedRecord", () => {
  it("remaps keys and drops entries whose index maps to null", () => {
    const record = { "tags[0]": true, "tags[1]": true, "tags[2]": true, title: true };
    expect(remapKeyedRecord(record, ["tags"], removeAt(0))).toEqual({
      "tags[0]": true,
      "tags[1]": true,
      title: true,
    });
  });
});
