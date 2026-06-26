import { describe, expect, it } from "vite-plus/test";
import { formDataToObject, parseFieldPath } from "../src/FormData.ts";

describe("parseFieldPath", () => {
  it("parses dot notation", () => {
    expect(parseFieldPath("author.name")).toEqual(["author", "name"]);
  });

  it("parses bracket notation", () => {
    expect(parseFieldPath("author[name]")).toEqual(["author", "name"]);
    expect(parseFieldPath("tags[0]")).toEqual(["tags", "0"]);
    expect(parseFieldPath("a[b][c]")).toEqual(["a", "b", "c"]);
  });

  it("parses the append form as an empty trailing token", () => {
    expect(parseFieldPath("tags[]")).toEqual(["tags", ""]);
  });

  it("mixes dot and bracket", () => {
    expect(parseFieldPath("a.b[0].c")).toEqual(["a", "b", "0", "c"]);
  });
});

describe("formDataToObject", () => {
  it("builds a flat object", () => {
    const fd = new URLSearchParams({ title: "Hello", body: "World" });
    expect(formDataToObject(fd)).toEqual({ title: "Hello", body: "World" });
  });

  it("nests dot/bracket paths", () => {
    const fd = new URLSearchParams();
    fd.append("author.name", "Ada");
    fd.append("author[email]", "ada@example.com");
    expect(formDataToObject(fd)).toEqual({ author: { name: "Ada", email: "ada@example.com" } });
  });

  it("builds arrays from indexed keys", () => {
    const fd = new URLSearchParams();
    fd.append("tags[0]", "a");
    fd.append("tags[1]", "b");
    const out = formDataToObject(fd);
    expect(out.tags).toEqual(["a", "b"]);
  });

  it("builds arrays from append keys", () => {
    const fd = new URLSearchParams();
    fd.append("tags[]", "a");
    fd.append("tags[]", "b");
    expect(formDataToObject(fd).tags).toEqual(["a", "b"]);
  });

  it("collapses repeated bare keys into an array", () => {
    const fd = new URLSearchParams();
    fd.append("colour", "red");
    fd.append("colour", "blue");
    expect(formDataToObject(fd).colour).toEqual(["red", "blue"]);
  });

  it("builds nested arrays of objects", () => {
    const fd = new URLSearchParams();
    fd.append("authors[0].name", "Ada");
    fd.append("authors[0].role", "lead");
    fd.append("authors[1].name", "Linus");
    const out = formDataToObject(fd) as { authors: Array<Record<string, string>> };
    expect(out.authors).toEqual([{ name: "Ada", role: "lead" }, { name: "Linus" }]);
  });

  it("accepts entry iterables directly", () => {
    expect(
      formDataToObject([
        ["a", "1"],
        ["b", "2"],
      ]),
    ).toEqual({ a: "1", b: "2" });
  });
});
