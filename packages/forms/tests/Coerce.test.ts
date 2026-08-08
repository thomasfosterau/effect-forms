import { describe, expect, it } from "vite-plus/test";
import {
  booleanFromCheckbox,
  emptyToNull,
  emptyToUndefined,
  numberFromField,
  trimToNull,
  trimToUndefined,
} from "../src/Coerce.ts";

describe("emptyToUndefined / emptyToNull", () => {
  it("emptyToUndefined drops blanks to undefined", () => {
    expect(emptyToUndefined("")).toBeUndefined();
    expect(emptyToUndefined(undefined)).toBeUndefined();
    expect(emptyToUndefined("x")).toBe("x");
  });

  it("emptyToNull is tri-state", () => {
    expect(emptyToNull(undefined)).toBeUndefined();
    expect(emptyToNull("")).toBeNull();
    expect(emptyToNull(null)).toBeNull();
    expect(emptyToNull("x")).toBe("x");
  });
});

describe("trimToUndefined / trimToNull", () => {
  it("trimToUndefined collapses whitespace-only to undefined", () => {
    expect(trimToUndefined("   ")).toBeUndefined();
    expect(trimToUndefined(" a ")).toBe("a");
    expect(trimToUndefined(undefined)).toBeUndefined();
  });

  it("trimToNull clears whitespace-only to null but skips undefined", () => {
    expect(trimToNull("   ")).toBeNull();
    expect(trimToNull(undefined)).toBeUndefined();
    expect(trimToNull(" a ")).toBe("a");
  });
});

describe("numberFromField", () => {
  it("non-nullable: blank skips, value parses", () => {
    expect(numberFromField("", { nullable: false })).toBeUndefined();
    expect(numberFromField(undefined, { nullable: false })).toBeUndefined();
    expect(numberFromField("12", { nullable: false })).toBe(12);
  });

  it("nullable: blank clears, value parses", () => {
    expect(numberFromField("", { nullable: true })).toBeNull();
    expect(numberFromField(undefined, { nullable: true })).toBeUndefined();
    expect(numberFromField("3.5", { nullable: true })).toBe(3.5);
  });
});

describe("booleanFromCheckbox", () => {
  it("absent is false, present is true", () => {
    expect(booleanFromCheckbox(undefined)).toBe(false);
    expect(booleanFromCheckbox("on")).toBe(true);
    expect(booleanFromCheckbox("true")).toBe(true);
    expect(booleanFromCheckbox("1")).toBe(true);
  });

  it("explicit falsey strings are false", () => {
    expect(booleanFromCheckbox("false")).toBe(false);
    expect(booleanFromCheckbox("0")).toBe(false);
    expect(booleanFromCheckbox("off")).toBe(false);
    expect(booleanFromCheckbox("")).toBe(false);
  });
});
