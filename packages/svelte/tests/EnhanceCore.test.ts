import { FormData as FormBody, Result, State } from "@thomasfosterau/effect-forms";
import { Schema } from "effect";
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

  it("stringifies string, number, boolean and bigint leaves", () => {
    expect(objectToEntries({ s: "x", n: 1.5, t: true, f: false, big: 12n })).toEqual([
      ["s", "x"],
      ["n", "1.5"],
      ["t", "true"],
      ["f", "false"],
      ["big", "12"],
    ]);
  });

  it("omits function and symbol leaves at the top level", () => {
    expect(objectToEntries({ a: () => 1, s: Symbol("x"), n: 1n, b: true, z: null })).toEqual([
      ["n", "1"],
      ["b", "true"],
      ["z", ""],
    ]);
  });

  it("omits function and symbol leaves nested in an object", () => {
    expect(
      objectToEntries({ author: { name: "Ada", greet: () => "hi", tag: Symbol("t") } }),
    ).toEqual([["author.name", "Ada"]]);
  });

  it("omits function and symbol items in an array, keeping the others' indices", () => {
    expect(objectToEntries({ list: ["a", () => 1, Symbol("x"), null, 2n] })).toEqual([
      ["list[0]", "a"],
      ["list[3]", ""],
      ["list[4]", "2"],
    ]);
  });

  it("leaves function and symbol values out of FormData", () => {
    const fd = objectToFormData({ a: "1", cb: () => 1, sym: Symbol("x") });
    expect([...fd.keys()]).toEqual(["a"]);
  });

  it("builds FormData", () => {
    const fd = objectToFormData({ a: "1", b: "2" });
    expect(fd.get("a")).toBe("1");
    expect(fd.get("b")).toBe("2");
  });
});

describe("objectToEntries / objectToFormData: File, Blob, Date and keyless objects", () => {
  const file = (): File => new File(["hello"], "avatar.png", { type: "image/png" });

  it("appends a top-level File to FormData as the same File, keeping its name and content", async () => {
    const avatar = file();
    const got = objectToFormData({ avatar }).get("avatar");
    expect(got).toBeInstanceOf(File);
    expect(got).toBe(avatar);
    expect((got as File).name).toBe("avatar.png");
    expect(await (got as File).text()).toBe("hello");
  });

  it("appends a nested File under its dotted name", async () => {
    const got = objectToFormData({ author: { photo: file() } }).get("author.photo");
    expect(got).toBeInstanceOf(File);
    expect((got as File).name).toBe("avatar.png");
    expect(await (got as File).text()).toBe("hello");
  });

  it("appends a File array item under its index", async () => {
    const fd = objectToFormData({ files: ["note", file()] });
    expect(fd.get("files[0]")).toBe("note");
    const got = fd.get("files[1]");
    expect(got).toBeInstanceOf(File);
    expect((got as File).name).toBe("avatar.png");
    expect(await (got as File).text()).toBe("hello");
  });

  it('appends a bare Blob to FormData as a File named "blob" with the Blob\'s content and type', async () => {
    const got = objectToFormData({ data: new Blob(["bytes"], { type: "text/plain" }) }).get("data");
    expect(got).toBeInstanceOf(File);
    expect((got as File).name).toBe("blob");
    expect((got as Blob).type).toBe("text/plain");
    expect(await (got as Blob).text()).toBe("bytes");
  });

  it("omits File and Blob leaves from the string-only objectToEntries, keeping other indices", () => {
    expect(objectToEntries({ avatar: file(), list: [new Blob(["x"]), "b"], title: "Hi" })).toEqual([
      ["list[1]", "b"],
      ["title", "Hi"],
    ]);
  });

  it("encodes a Date as its YYYY-MM-DD, top-level, nested and as an array item", () => {
    const born = new Date("2026-10-09T12:00:00Z");
    expect(objectToEntries({ born, author: { born }, dates: [born] })).toEqual([
      ["born", "2026-10-09"],
      ["author.born", "2026-10-09"],
      ["dates[0]", "2026-10-09"],
    ]);
  });

  it("encodes a top-level Date passed with a prefix as a single entry", () => {
    expect(objectToEntries(new Date("2026-10-09T12:00:00Z"), "born")).toEqual([
      ["born", "2026-10-09"],
    ]);
  });

  it("encodes a Date from its UTC day, not the local one (23:30 at UTC-5 is the next day in UTC)", () => {
    // Pin a zone west of UTC so a local-time encoder would differ even on a
    // UTC host such as CI; Node applies a runtime `TZ` change immediately.
    const previous = process.env.TZ;
    process.env.TZ = "America/Chicago";
    try {
      const born = new Date("2026-10-09T23:30:00-05:00");
      expect(born.getDate()).toBe(9); // the local day really is the 9th
      expect(objectToEntries({ born })).toEqual([["born", "2026-10-10"]]);
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it("keeps the expanded year of a Date outside 0000-9999 rather than cutting it off", () => {
    expect(objectToEntries({ far: new Date("+010000-01-02T00:00:00Z") })).toEqual([
      ["far", "+010000-01-02"],
    ]);
  });

  it("omits an invalid Date rather than throwing, keeping other indices", () => {
    const invalid = new Date("not a date");
    expect(objectToEntries({ born: invalid, dates: [invalid, new Date(0)] })).toEqual([
      ["dates[1]", "1970-01-01"],
    ]);
  });

  it("omits Map and Set values (they have no own enumerable fields)", () => {
    const fd = objectToFormData({ a: "1", map: new Map([["k", "v"]]), set: new Set(["x"]) });
    expect([...fd.keys()]).toEqual(["a"]);
    expect(objectToEntries({ map: new Map([["k", "v"]]), set: new Set(["x"]) })).toEqual([]);
  });

  it("round-trips a File and a Date through the core decoder, FormData.formDataToObject", () => {
    const avatar = file();
    const decoded = FormBody.formDataToObject(
      objectToFormData({ avatar, born: new Date("2026-10-09T23:30:00-05:00") }),
    );
    expect(decoded.avatar).toBe(avatar);
    expect(decoded.born).toBe("2026-10-10");
  });

  it("decodes the encoded Date back to the same UTC day with Schema.DateFromString", () => {
    const born = new Date("2026-10-09T23:30:00-05:00");
    const decoded = FormBody.formDataToObject(objectToFormData({ born }));
    const date = Schema.decodeUnknownSync(Schema.DateFromString)(decoded.born);
    expect(date.toISOString()).toBe("2026-10-10T00:00:00.000Z");
    expect(date.toISOString().slice(0, 10)).toBe(born.toISOString().slice(0, 10));
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
