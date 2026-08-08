import { Result, State } from "@thomasfosterau/effect-forms";
import { describe, expect, it } from "vite-plus/test";
import {
  computeDataApplication,
  objectToEntries,
  objectToFormData,
  parseActionResult,
  resultToUpdate,
} from "../src/EnhanceCore.ts";
import { computeTainted, isAnyTainted } from "../src/Tainted.ts";

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

describe("computeDataApplication", () => {
  const initial = { title: "Old" };
  const submittedData = { title: "New" };

  it("on a plain successful submit, adopts the server data and rebases the baseline to it", () => {
    const appliedData = { title: "New (echoed)" };
    const applied = computeDataApplication({
      isSuccess: true,
      appliedData,
      initial,
      submittedData,
      resetForm: false,
      autoSubmit: false,
    });
    expect(applied).toEqual({ data: appliedData, rebaseTo: appliedData });
  });

  it("on a failed submit, adopts the server data but does not rebase the baseline", () => {
    const appliedData = { title: "New" };
    const applied = computeDataApplication({
      isSuccess: false,
      appliedData,
      initial,
      submittedData,
      resetForm: false,
      autoSubmit: false,
    });
    expect(applied).toEqual({ data: appliedData, rebaseTo: undefined });
  });

  it("with resetForm, a successful submit reverts data and rebases the baseline to the original seed", () => {
    const applied = computeDataApplication({
      isSuccess: true,
      appliedData: { title: "New" },
      initial,
      submittedData,
      resetForm: true,
      autoSubmit: false,
    });
    expect(applied).toEqual({ data: initial, rebaseTo: initial });
  });

  it("with resetForm, a failed submit adopts the server data (not the seed) and does not rebase", () => {
    const appliedData = { title: "New" };
    const applied = computeDataApplication({
      isSuccess: false,
      appliedData,
      initial,
      submittedData,
      resetForm: true,
      autoSubmit: false,
    });
    expect(applied).toEqual({ data: appliedData, rebaseTo: undefined });
  });

  it("auto-submit keeps local data as-is, but rebases the baseline to the submitted snapshot on success", () => {
    const applied = computeDataApplication({
      isSuccess: true,
      appliedData: { title: "server echo" },
      initial,
      submittedData,
      resetForm: false,
      autoSubmit: true,
    });
    expect(applied).toEqual({ data: undefined, rebaseTo: submittedData });
  });

  it("auto-submit does not rebase on a failed submit", () => {
    const applied = computeDataApplication({
      isSuccess: false,
      appliedData: { title: "server echo" },
      initial,
      submittedData,
      resetForm: false,
      autoSubmit: true,
    });
    expect(applied).toEqual({ data: undefined, rebaseTo: undefined });
  });

  it("save-then-navigate: after a successful submit, the field is no longer tainted against the new baseline", () => {
    const seeded = { title: "Old" };
    const edited = { title: "Saved" };

    // Before submitting, the edit is tainted against the seed.
    expect(isAnyTainted(computeTainted(seeded, edited))).toBe(true);

    // A successful submit rebases the baseline to what was actually saved.
    const applied = computeDataApplication({
      isSuccess: true,
      appliedData: edited,
      initial: seeded,
      submittedData: edited,
      resetForm: false,
      autoSubmit: false,
    });
    const rebasedInitial = applied.rebaseTo!;

    // The `beforeunload` guard's `isTainted` check now sees no changes.
    expect(isAnyTainted(computeTainted(rebasedInitial, edited))).toBe(false);
  });
});
