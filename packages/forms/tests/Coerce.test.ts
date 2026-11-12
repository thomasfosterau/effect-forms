import { describe, expect, it } from "vite-plus/test";
import {
  booleanFromCheckbox,
  emptyToCarryForward,
  emptyToClear,
  numberFromField,
  trimToCarryForward,
  trimToClear,
} from "../src/Coerce.ts";
import * as TriState from "../src/TriState.ts";

describe("emptyToCarryForward / emptyToClear", () => {
  it("emptyToCarryForward carries blanks forward", () => {
    expect(emptyToCarryForward("")).toEqual(TriState.carryForward);
    expect(emptyToCarryForward(undefined)).toEqual(TriState.carryForward);
    expect(emptyToCarryForward("x")).toEqual(TriState.assign("x"));
  });

  it("emptyToClear is tri-state", () => {
    expect(emptyToClear(undefined)).toEqual(TriState.carryForward);
    expect(emptyToClear("")).toEqual(TriState.clear);
    expect(emptyToClear("x")).toEqual(TriState.assign("x"));
  });
});

describe("trimToCarryForward / trimToClear", () => {
  it("trimToCarryForward carries whitespace-only forward", () => {
    expect(trimToCarryForward("   ")).toEqual(TriState.carryForward);
    expect(trimToCarryForward(" a ")).toEqual(TriState.assign("a"));
    expect(trimToCarryForward(undefined)).toEqual(TriState.carryForward);
  });

  it("trimToClear clears whitespace-only but carries absent forward", () => {
    expect(trimToClear("   ")).toEqual(TriState.clear);
    expect(trimToClear(undefined)).toEqual(TriState.carryForward);
    expect(trimToClear(" a ")).toEqual(TriState.assign("a"));
  });
});

describe("numberFromField", () => {
  it("non-nullable (the default): blank carries forward, value parses", () => {
    expect(numberFromField("")).toEqual(TriState.carryForward);
    expect(numberFromField(undefined, { nullable: false })).toEqual(TriState.carryForward);
    expect(numberFromField("12", { nullable: false })).toEqual(TriState.assign(12));
  });

  it("nullable: blank clears, value parses", () => {
    expect(numberFromField("", { nullable: true })).toEqual(TriState.clear);
    expect(numberFromField(undefined, { nullable: true })).toEqual(TriState.carryForward);
    expect(numberFromField("3.5", { nullable: true })).toEqual(TriState.assign(3.5));
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
