import { describe, expect, it } from "vite-plus/test";
import { parse } from "../src/Mode.ts";

describe("Mode.parse", () => {
  it("defaults to onSubmit with no debounce or auto-submit, revalidate onChange", () => {
    expect(parse()).toEqual({
      validation: "onSubmit",
      debounce: null,
      autoSubmit: false,
      revalidate: "onChange",
    });
    expect(parse({})).toEqual({
      validation: "onSubmit",
      debounce: null,
      autoSubmit: false,
      revalidate: "onChange",
    });
  });

  it("resolves onBlur, honouring autoSubmit and ignoring debounce", () => {
    expect(parse({ validation: "onBlur" })).toEqual({
      validation: "onBlur",
      debounce: null,
      autoSubmit: false,
      revalidate: "onChange",
    });
    expect(parse({ validation: "onBlur", autoSubmit: true })).toEqual({
      validation: "onBlur",
      debounce: null,
      autoSubmit: true,
      revalidate: "onChange",
    });
  });

  it("resolves onChange, converting debounce to milliseconds", () => {
    expect(parse({ validation: "onChange" })).toEqual({
      validation: "onChange",
      debounce: null,
      autoSubmit: false,
      revalidate: "onChange",
    });
    expect(parse({ validation: "onChange", debounce: "300 millis" })).toEqual({
      validation: "onChange",
      debounce: 300,
      autoSubmit: false,
      revalidate: "onChange",
    });
    expect(parse({ validation: "onChange", debounce: 500, autoSubmit: true })).toEqual({
      validation: "onChange",
      debounce: 500,
      autoSubmit: true,
      revalidate: "onChange",
    });
  });

  it("resolves revalidate independently of validation, defaulting to onChange", () => {
    expect(parse({ revalidate: "onBlur" })).toEqual({
      validation: "onSubmit",
      debounce: null,
      autoSubmit: false,
      revalidate: "onBlur",
    });
    expect(parse({ validation: "onChange", revalidate: "never" })).toEqual({
      validation: "onChange",
      debounce: null,
      autoSubmit: false,
      revalidate: "never",
    });
  });
});
