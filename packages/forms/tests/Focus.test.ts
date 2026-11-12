import * as Option from "effect/Option";
import { describe, expect, expectTypeOf, it } from "vite-plus/test";
import * as Focus from "../src/Focus.ts";

interface Post {
  readonly title: string;
  readonly author: { readonly name: string; readonly bio?: string };
  readonly tags: ReadonlyArray<string>;
  readonly links: ReadonlyArray<{ readonly url: string }>;
  readonly editor?: { readonly name: string };
  readonly scores: Readonly<Record<string, number>>;
}

const post: Post = {
  title: "Optics",
  author: { name: "Ada" },
  tags: ["effect", "svelte"],
  links: [{ url: "https://a.example" }],
  scores: { ada: 3 },
};

const root = Focus.root<Post>();

describe("Focus.root", () => {
  it("focuses the whole value at the empty path", () => {
    expect(root.path).toEqual([]);
    expect(root.get(post)).toBe(post);
    expect(Focus.name(root)).toBe("");
  });
});

describe("Focus.Lens", () => {
  const name = root.key("author").key("name");

  it("records its path and renders it as a field name", () => {
    expect(name.path).toEqual(["author", "name"]);
    expect(Focus.name(name)).toBe("author.name");
  });

  it("reads, replaces and modifies without mutating", () => {
    expect(name.get(post)).toBe("Ada");
    expect(name.getOption(post)).toEqual(Option.some("Ada"));
    const next = name.replace("Grace", post);
    expect(next.author.name).toBe("Grace");
    expect(post.author.name).toBe("Ada");
    expect(next.tags).toBe(post.tags);
    expect(name.modify((n) => n.toUpperCase())(post).author.name).toBe("ADA");
  });

  it("types the focused value", () => {
    expectTypeOf(name).toEqualTypeOf<Focus.Lens<Post, string>>();
    expectTypeOf(name.get(post)).toEqualTypeOf<string>();
    expectTypeOf(root.key("tags").at(0)).toEqualTypeOf<Focus.Optional<Post, string>>();
    expectTypeOf(root.key("editor").defined().key("name")).toEqualTypeOf<
      Focus.Optional<Post, string>
    >();
  });

  it("is a total lens on a record key, typed as the record's values", () => {
    const ada = root.key("scores").key("ada");
    expect(ada.get(post)).toBe(3);
    expect(ada.replace(4, post).scores).toEqual({ ada: 4 });
  });
});

describe("Focus.Optional", () => {
  const first = root.key("tags").at(0);
  const missing = root.key("tags").at(5);

  it("records the index segment", () => {
    expect(first.path).toEqual(["tags", 0]);
    expect(Focus.name(root.key("links").at(0).key("url"))).toBe("links[0].url");
  });

  it("reads Some in range and None out of range", () => {
    expect(first.getOption(post)).toEqual(Option.some("effect"));
    expect(missing.getOption(post)).toEqual(Option.none());
  });

  it("replaces in range and leaves the data unchanged out of range", () => {
    expect(first.replace("optic", post).tags).toEqual(["optic", "svelte"]);
    expect(missing.replace("optic", post)).toBe(post);
    expect(first.modify((t) => `${t}!`)(post).tags).toEqual(["effect!", "svelte"]);
  });

  it("keys into an item", () => {
    const url = root.key("links").at(0).key("url");
    expect(url.replace("https://b.example", post).links).toEqual([{ url: "https://b.example" }]);
    expect(root.key("links").at(3).key("url").replace("x", post)).toBe(post);
  });

  it("checks a record key with `at`", () => {
    const grace = root.key("scores").at("grace");
    expect(grace.getOption(post)).toEqual(Option.none());
    expect(root.key("scores").at("ada").getOption(post)).toEqual(Option.some(3));
  });

  it("steps through an optional branch with `defined`, keeping the path", () => {
    const editor = root.key("editor").defined().key("name");
    expect(editor.path).toEqual(["editor", "name"]);
    expect(editor.getOption(post)).toEqual(Option.none());
    expect(editor.replace("Grace", post)).toBe(post);
    const withEditor: Post = { ...post, editor: { name: "Linus" } };
    expect(editor.getOption(withEditor)).toEqual(Option.some("Linus"));
    expect(editor.replace("Grace", withEditor).editor).toEqual({ name: "Grace" });
  });

  it("indexes a mutable array", () => {
    interface Draft {
      tags: string[];
    }
    const tag = Focus.root<Draft>().key("tags").at(1);
    const draft: Draft = { tags: ["a", "b"] };
    expect(tag.replace("z", draft).tags).toEqual(["a", "z"]);
    expect(draft.tags).toEqual(["a", "b"]);
  });

  it("chains through nested optionals", () => {
    interface Grid {
      readonly rows: ReadonlyArray<ReadonlyArray<number>>;
    }
    const cell = Focus.root<Grid>().key("rows").at(1).at(0);
    const grid: Grid = { rows: [[1], [2, 3]] };
    expect(cell.path).toEqual(["rows", 1, 0]);
    expect(cell.replace(9, grid).rows).toEqual([[1], [9, 3]]);
    const nested = Focus.root<Post>().key("editor").defined().defined();
    expect(nested.path).toEqual(["editor"]);
  });

  it("orElse reads a fallback where nothing is focused, and writes through", () => {
    const tag = missing.orElse("");
    expect(tag.get(post)).toBe("");
    expect(first.orElse("").get(post)).toBe("effect");
    expect(tag.replace("x", post)).toBe(post);
    expect(first.orElse("").replace("x", post).tags).toEqual(["x", "svelte"]);
    expect(tag.path).toEqual(["tags", 5]);
  });
});
