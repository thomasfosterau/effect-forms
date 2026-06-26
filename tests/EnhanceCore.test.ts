import { Result, State } from "@thomasfosterau/effect-forms";
import { describe, expect, it } from "vite-plus/test";
import {
  objectToEntries,
  objectToFormData,
  parseActionResult,
  resultToUpdate,
} from "../src/EnhanceCore.ts";

// Terse local aliases onto the namespaced core exports.
type FormActionResult<A, Message = unknown> = Result.FormActionResult<A, Message>;
const { failure, success } = Result;
const makeFormState = State.make;

describe("objectToEntries / objectToFormData", () => {
  it("flattens scalars and nested objects", () => {
    expect(objectToEntries({ title: "Hi", author: { name: "Ada" } })).toEqual([
      ["title", "Hi"],
      ["author.name", "Ada"],
    ]);
  });

  it("indexes arrays", () => {
    expect(objectToEntries({ tags: ["a", "b"] })).toEqual([
      ["tags[0]", "a"],
      ["tags[1]", "b"],
    ]);
  });

  it("renders null as empty and skips undefined", () => {
    expect(objectToEntries({ a: null, b: undefined, c: 3 })).toEqual([
      ["a", ""],
      ["c", "3"],
    ]);
  });

  it("builds FormData", () => {
    const fd = objectToFormData({ a: "1", b: "2" });
    expect(fd.get("a")).toBe("1");
    expect(fd.get("b")).toBe("2");
  });
});

describe("parseActionResult", () => {
  it("passes through a tagged action result", () => {
    const result = success(makeFormState({ a: 1 }));
    expect(parseActionResult(result)).toBe(result);
  });

  it("maps a bare valid FormState to Success", () => {
    const state = makeFormState({ a: 1 });
    const parsed = parseActionResult(state, 200);
    expect(parsed._tag).toBe("Success");
  });

  it("maps a bare invalid FormState to Failure", () => {
    const state = makeFormState({ a: 1 }, { errors: { a: ["bad"] } });
    const parsed = parseActionResult(state, 400);
    expect(parsed._tag).toBe("Failure");
  });

  it("returns an Error for an unrecognised body", () => {
    expect(parseActionResult({ nope: true })._tag).toBe("Error");
  });
});

describe("resultToUpdate", () => {
  it("Success → data + errors + valid", () => {
    const update = resultToUpdate(success(makeFormState({ a: 1 })));
    expect(update).toMatchObject({ data: { a: 1 }, valid: true });
  });

  it("Failure → data + errors + invalid", () => {
    const update = resultToUpdate(failure(makeFormState({ a: 1 }, { errors: { a: ["x"] } })));
    expect(update.valid).toBe(false);
    expect(update.errors).toEqual({ a: ["x"] });
  });

  it("Redirect → redirect location", () => {
    const result: FormActionResult<unknown> = { _tag: "Redirect", status: 303, location: "/done" };
    expect(resultToUpdate(result)).toEqual({ redirect: "/done" });
  });

  it("Error → error message", () => {
    const result: FormActionResult<unknown> = { _tag: "Error", status: 500, message: "boom" };
    expect(resultToUpdate(result)).toEqual({ error: "boom", valid: false });
  });
});
