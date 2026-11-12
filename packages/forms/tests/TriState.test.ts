import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as TriState from "../src/TriState.ts";

describe("TriState constructors", () => {
  it("builds the three tagged states", () => {
    expect(TriState.carryForward).toEqual({ _tag: "CarryForward" });
    expect(TriState.clear).toEqual({ _tag: "Clear" });
    expect(TriState.assign(0)).toEqual({ _tag: "Assign", value: 0 });
  });
});

describe("TriState.clearable / clearableNullOr", () => {
  it("clearable decodes absent / null / value to absent / None / Some and round-trips", () => {
    const Update = Schema.Struct({ summary: TriState.clearable(Schema.String) });
    const decode = Schema.decodeUnknownSync(Update);
    expect(decode({})).toEqual({});
    expect(decode({ summary: null })).toEqual({ summary: Option.none() });
    expect(decode({ summary: "x" })).toEqual({ summary: Option.some("x") });
    expect(Schema.encodeSync(Update)({ summary: Option.none() })).toEqual({ summary: null });
  });

  it("clearableNullOr keeps the nullable encoding", () => {
    const decode = Schema.decodeUnknownSync(
      Schema.Struct({ birthPlaceId: TriState.clearableNullOr(Schema.String) }),
    );
    expect(decode({})).toEqual({});
    expect(decode({ birthPlaceId: null })).toEqual({ birthPlaceId: null });
    expect(decode({ birthPlaceId: "x" })).toEqual({ birthPlaceId: "x" });
  });
});

describe("TriState readers", () => {
  it("read keeps all three states of the Option encoding apart", () => {
    expect(TriState.read(undefined)).toEqual(TriState.carryForward);
    expect(TriState.read(Option.none())).toEqual(TriState.clear);
    expect(TriState.read(Option.some(1))).toEqual(TriState.assign(1));
  });

  it("readNullOr keeps all three states of the nullable encoding apart, falsy values assigned", () => {
    expect(TriState.readNullOr(undefined)).toEqual(TriState.carryForward);
    expect(TriState.readNullOr(null)).toEqual(TriState.clear);
    expect(TriState.readNullOr(0)).toEqual(TriState.assign(0));
    expect(TriState.readNullOr("")).toEqual(TriState.assign(""));
  });

  it("suppliedValue / suppliedNullOr fold carry-forward and clear together", () => {
    expect(TriState.suppliedValue(undefined)).toEqual(Option.none());
    expect(TriState.suppliedValue(Option.none())).toEqual(Option.none());
    expect(TriState.suppliedValue(Option.some("a"))).toEqual(Option.some("a"));
    expect(TriState.suppliedNullOr(undefined)).toEqual(Option.none());
    expect(TriState.suppliedNullOr(null)).toEqual(Option.none());
    expect(TriState.suppliedNullOr("")).toEqual(Option.some(""));
  });
});

describe("TriState.match", () => {
  it("folds each state through its own handler", () => {
    const describeState = TriState.match({
      onCarryForward: () => "unchanged",
      onClear: () => "cleared",
      onAssign: (value: string) => `set to ${value}`,
    });
    expect(describeState(TriState.carryForward)).toBe("unchanged");
    expect(describeState(TriState.clear)).toBe("cleared");
    expect(describeState(TriState.assign("Ada"))).toBe("set to Ada");
  });
});
