import { describe, expect, it } from "vite-plus/test";
import { computeTainted, deepEqual, isAnyTainted, isTaintedAt } from "../src/Tainted.ts";

describe("deepEqual", () => {
  it("compares scalars, arrays, objects", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual([1, 2], [1, 2])).toBe(true);
    expect(deepEqual([1, 2], [1, 3])).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});

describe("computeTainted", () => {
  it("flags changed scalar leaves", () => {
    expect(computeTainted({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual({ b: true });
  });

  it("recurses into nested objects", () => {
    expect(computeTainted({ author: { name: "Ada" } }, { author: { name: "Bob" } })).toEqual({
      author: { name: true },
    });
  });

  it("treats arrays as leaves", () => {
    expect(computeTainted({ tags: ["a"] }, { tags: ["a", "b"] })).toEqual({ tags: true });
  });

  it("is empty when nothing changed", () => {
    expect(computeTainted({ a: 1 }, { a: 1 })).toEqual({});
  });
});

describe("isAnyTainted / isTaintedAt", () => {
  it("isAnyTainted detects deep taint", () => {
    expect(isAnyTainted({})).toBe(false);
    expect(isAnyTainted({ a: { b: true } })).toBe(true);
    expect(isAnyTainted({ a: {} })).toBe(false);
  });

  it("isTaintedAt resolves a path", () => {
    const tainted = { author: { name: true }, title: true };
    expect(isTaintedAt(tainted, ["title"])).toBe(true);
    expect(isTaintedAt(tainted, ["author", "name"])).toBe(true);
    expect(isTaintedAt(tainted, ["author"])).toBe(true);
    expect(isTaintedAt(tainted, ["missing"])).toBe(false);
  });
});
