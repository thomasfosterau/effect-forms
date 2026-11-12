/**
 * Typed focuses into a form's data: Effect `Optic`s that also know their
 * {@link FormPath}.
 *
 * A focus names one place in a form data tree twice over. Its `optic` (an
 * `effect/Optic` lens or optional) reads and writes the value there with the
 * value's static type, so a write needs no assertion. Its `path` is the
 * {@link FormPath} the error tree, the field `name` attribute
 * (`author.name`, `tags[0]`) and the touched / dirty bookkeeping use. Build
 * one from {@link root} with the same names `Optic` uses: `.key("author")`
 * for a property, `.at(0)` for an array item, `.defined()` to step through
 * an optional (`X | undefined`) value.
 *
 * A {@link Lens} always finds its value; an {@link Optional} may not (an
 * array index out of range, an absent optional branch): reading it answers an
 * `Option`, and writing where it finds nothing leaves the data unchanged.
 * {@link Optional.orElse} turns one into a lens with a fallback, for an input
 * that needs a value to render.
 *
 * Paths that arrive at runtime (a server error's pointer, a `FormData` key)
 * carry no static type, so they stay {@link FormPath}s and go through the
 * untyped {@link module:effect-forms/Path} and {@link
 * module:effect-forms/Errors} functions instead.
 *
 * @copyright Thomas Foster
 * @module effect-forms/Focus
 */

import * as Optic from "effect/Optic";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import type { IsUnion } from "effect/Types";
import type { FormPath } from "./Issues.ts";
import { toString } from "./Path.ts";

/**
 * `Optic`'s own guard against focusing into a union: an empty rest tuple for
 * a non-union `A`, and a one-message tuple (a compile error at the call
 * site) for a union. Declared exactly as `Optic` declares it, so a focus can
 * forward its argument to `Optic`'s `key` / `at`.
 */
type ForbidUnion<A, Message extends string> = IsUnion<A> extends true ? [Message] : [];

/**
 * Anything that names a place in a form data tree by its {@link FormPath}:
 * every {@link Focus}, and all the untyped readers (error lookups, posted
 * values) need.
 */
export interface HasPath {
  /** The place, as the segments the error tree and field names use. */
  readonly path: FormPath;
}

/**
 * A focus that always finds its value: an `Optic.Lens` from the form data
 * `S` to the value `A`, together with that value's {@link FormPath}.
 *
 * @example
 * ```ts
 * import { Focus } from "@thomasfosterau/effect-forms"
 *
 * type Post = { readonly author: { readonly name: string } }
 * const name = Focus.root<Post>().key("author").key("name")
 *
 * console.log(name.get({ author: { name: "Ada" } })) // "Ada"
 * console.log(name.replace("Grace", { author: { name: "Ada" } })) // { author: { name: "Grace" } }
 * console.log(Focus.name(name)) // "author.name"
 * ```
 */
export class Lens<in out S, in out A> implements HasPath {
  /** Discriminates a {@link Lens} from an {@link Optional}. */
  readonly _tag = "Lens";
  /** The underlying `effect/Optic` lens. */
  readonly optic: Optic.Lens<S, A>;
  /** Where the focus points, as {@link FormPath} segments. */
  readonly path: FormPath;

  /** Pair an `Optic.Lens` with the path it focuses; {@link root} and the focusing methods build these. */
  constructor(optic: Optic.Lens<S, A>, path: FormPath) {
    this.optic = optic;
    this.path = path;
  }

  /** The focused value of `s`. */
  get(s: S): A {
    return this.optic.get(s);
  }

  /** The focused value of `s`, as an `Option` (always `Some` for a lens). */
  getOption(s: S): Option.Option<A> {
    return Option.some(this.optic.get(s));
  }

  /** A copy of `s` with the focused value replaced by `a`; `s` is never mutated. */
  replace(a: A, s: S): S {
    return this.optic.replace(a, s);
  }

  /** The function applying `f` to the focused value, returning a new `S`. */
  modify(f: (a: A) => A): (s: S) => S {
    return this.optic.modify(f);
  }

  /**
   * Focus the property `key` of the current (object) value. A union value
   * (`X | undefined` included) is a compile error: step through it with
   * {@link Lens.defined} first. On a `Record<string, X>` the result is a total
   * lens typed `X` (an absent key reads as `undefined`); {@link Lens.at} is
   * the checked alternative when the key may be absent.
   */
  key<B extends object, K extends Extract<keyof B, string>>(
    this: Lens<S, B>,
    key: K,
    ...err: ForbidUnion<B, "cannot use `key` on a union type">
  ): Lens<S, B[K]> {
    return new Lens(this.optic.key(key, ...err), [...this.path, key]);
  }

  /**
   * Focus the item at index `key` of the current array value, or the entry
   * `key` of a record, only where it exists (`Object.hasOwn`). An
   * {@link Optional}: an index out of range or an absent key reads as
   * `None`, and a write there leaves the data unchanged.
   */
  at<B extends object, K extends keyof B & (string | number)>(
    this: Lens<S, B>,
    key: K,
    ...err: ForbidUnion<B, "cannot use `at` on a union type">
  ): Optional<S, B[K]> {
    return new Optional(this.optic.at(key, ...err), [...this.path, key]);
  }

  /** Step through an optional value: `None` while it is `undefined`. The path is unchanged. */
  defined<B>(this: Lens<S, B>): Optional<S, Exclude<B, undefined>> {
    return new Optional(this.optic.notUndefined(), this.path);
  }
}

/**
 * A focus that may not find its value: an `Optic.Optional` from `S` to `A`,
 * together with that value's {@link FormPath}. Reading answers an `Option`;
 * writing where nothing is focused leaves the data unchanged.
 *
 * @example
 * ```ts
 * import { Focus } from "@thomasfosterau/effect-forms"
 * import * as Option from "effect/Option"
 *
 * type Post = { readonly tags: ReadonlyArray<string> }
 * const first = Focus.root<Post>().key("tags").at(0)
 *
 * console.log(Option.getOrElse(first.getOption({ tags: [] }), () => "none")) // "none"
 * console.log(first.replace("effect", { tags: ["svelte"] })) // { tags: ["effect"] }
 * console.log(first.replace("effect", { tags: [] })) // { tags: [] }: nothing to replace
 * console.log(Focus.name(first)) // "tags[0]"
 * ```
 */
export class Optional<in out S, in out A> implements HasPath {
  /** Discriminates an {@link Optional} from a {@link Lens}. */
  readonly _tag = "Optional";
  /** The underlying `effect/Optic` optional. */
  readonly optic: Optic.Optional<S, A>;
  /** Where the focus points, as {@link FormPath} segments. */
  readonly path: FormPath;

  /** Pair an `Optic.Optional` with the path it focuses; the focusing methods build these. */
  constructor(optic: Optic.Optional<S, A>, path: FormPath) {
    this.optic = optic;
    this.path = path;
  }

  /** The focused value of `s`, or `None` when the focus finds nothing. */
  getOption(s: S): Option.Option<A> {
    return Result.getSuccess(this.optic.getResult(s));
  }

  /** A copy of `s` with the focused value replaced by `a` (`s` itself when nothing is focused). */
  replace(a: A, s: S): S {
    return this.optic.replace(a, s);
  }

  /** The function applying `f` to the focused value, returning a new `S` (unchanged when nothing is focused). */
  modify(f: (a: A) => A): (s: S) => S {
    return this.optic.modify(f);
  }

  /** Focus the property `key` of the current (object) value — see {@link Lens.key}. */
  key<B extends object, K extends Extract<keyof B, string>>(
    this: Optional<S, B>,
    key: K,
    ...err: ForbidUnion<B, "cannot use `key` on a union type">
  ): Optional<S, B[K]> {
    return new Optional(this.optic.key(key, ...err), [...this.path, key]);
  }

  /** Focus an existing array item or record entry — see {@link Lens.at}. */
  at<B extends object, K extends keyof B & (string | number)>(
    this: Optional<S, B>,
    key: K,
    ...err: ForbidUnion<B, "cannot use `at` on a union type">
  ): Optional<S, B[K]> {
    return new Optional(this.optic.at(key, ...err), [...this.path, key]);
  }

  /** Step through an optional value: `None` while it is `undefined`. The path is unchanged. */
  defined<B>(this: Optional<S, B>): Optional<S, Exclude<B, undefined>> {
    return new Optional(this.optic.notUndefined(), this.path);
  }

  /**
   * A {@link Lens} reading `fallback` wherever this focus finds nothing, for
   * an input that needs a value to render (an array item's field). Writes go
   * through this focus, so a write where it finds nothing still leaves the
   * data unchanged.
   *
   * @example
   * ```ts
   * import { Focus } from "@thomasfosterau/effect-forms"
   *
   * type Post = { readonly tags: ReadonlyArray<string> }
   * const first = Focus.root<Post>().key("tags").at(0).orElse("")
   *
   * console.log(JSON.stringify(first.get({ tags: [] }))) // ""
   * console.log(first.get({ tags: ["svelte"] })) // "svelte"
   * ```
   */
  orElse(fallback: A): Lens<S, A> {
    const optic = this.optic;
    return new Lens(
      Optic.makeLens(
        (s: S) => Result.getOrElse(optic.getResult(s), () => fallback),
        (a: A, s: S) => optic.replace(a, s),
      ),
      this.path,
    );
  }
}

/** A typed focus from the form data `S` to a value `A`: a {@link Lens} or an {@link Optional}. */
export type Focus<S, A> = Lens<S, A> | Optional<S, A>;

/**
 * The focus on the whole of a form's data `S`: the empty path. Every other
 * focus is built from it.
 *
 * @example
 * ```ts
 * import { Focus } from "@thomasfosterau/effect-forms"
 *
 * type Signup = { readonly email: string; readonly tags: ReadonlyArray<string> }
 * const form = Focus.root<Signup>()
 *
 * console.log(form.path) // []
 * console.log(form.key("tags").at(1).path) // ["tags", 1]
 * ```
 */
export function root<S>(): Lens<S, S> {
  return new Lens(Optic.id<S>(), []);
}

/**
 * The focus's path in flat field-name notation (`author.name`, `tags[0]`):
 * the `name` attribute of the input bound to it, and what the body parser
 * reads back. See {@link module:effect-forms/Path.toString}.
 *
 * @example
 * ```ts
 * import { Focus } from "@thomasfosterau/effect-forms"
 *
 * type Post = { readonly links: ReadonlyArray<{ readonly url: string }> }
 * console.log(Focus.name(Focus.root<Post>().key("links").at(2).key("url"))) // "links[2].url"
 * ```
 */
export function name(focus: HasPath): string {
  return toString(focus.path);
}
