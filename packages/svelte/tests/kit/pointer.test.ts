import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";
import { fieldFromPointer, pathFromPointer } from "../../src/kit/index.ts";

describe("fieldFromPointer", () => {
  it("names the attribute a /data/attributes pointer points at", () => {
    expect(fieldFromPointer("/data/attributes/name")).toEqual(Option.some("name"));
  });

  it("keys by the top-level field, ignoring deeper segments", () => {
    expect(fieldFromPointer("/data/attributes/address/street")).toEqual(Option.some("address"));
  });

  it("decodes RFC 6901 escapes, ~1 before ~0", () => {
    expect(fieldFromPointer("/data/attributes/a~1b")).toEqual(Option.some("a/b"));
    expect(fieldFromPointer("/data/attributes/a~0b")).toEqual(Option.some("a~b"));
    expect(fieldFromPointer("/data/attributes/a~01")).toEqual(Option.some("a~1"));
  });

  it("is None for an absent or empty pointer", () => {
    expect(fieldFromPointer(undefined)).toEqual(Option.none());
    expect(fieldFromPointer("")).toEqual(Option.none());
  });

  it("is None for a pointer outside /data/attributes", () => {
    expect(fieldFromPointer("/data/relationships/author")).toEqual(Option.none());
    expect(fieldFromPointer("/data")).toEqual(Option.none());
    expect(fieldFromPointer("/data/attributes")).toEqual(Option.none());
    expect(fieldFromPointer("/meta/attributes/name")).toEqual(Option.none());
  });

  it("is None for an empty field segment", () => {
    expect(fieldFromPointer("/data/attributes/")).toEqual(Option.none());
  });
});

describe("pathFromPointer", () => {
  it("routes to the whole attribute path, integer segments as indices", () => {
    expect(pathFromPointer("/data/attributes/name")).toEqual(Option.some(["name"]));
    expect(pathFromPointer("/data/attributes/address/street")).toEqual(
      Option.some(["address", "street"]),
    );
    expect(pathFromPointer("/data/attributes/tags/0")).toEqual(Option.some(["tags", 0]));
  });

  it("decodes escapes in deeper segments and skips empty ones", () => {
    expect(pathFromPointer("/data/attributes/a/b~1c/")).toEqual(Option.some(["a", "b/c"]));
  });

  it("is None wherever fieldFromPointer is", () => {
    expect(pathFromPointer(undefined)).toEqual(Option.none());
    expect(pathFromPointer("/data/relationships/author")).toEqual(Option.none());
    expect(pathFromPointer("/data/attributes/")).toEqual(Option.none());
  });
});
