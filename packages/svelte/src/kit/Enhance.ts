/**
 * SvelteKit `$app/forms` glue for the form store. {@link enhanceForm}
 * returns spreadable `<form>` props — `<form {...enhanceForm(form)}>` — that
 * post to the page's derived action ({@link formAction}) through SvelteKit's
 * native `enhance`.
 *
 * `$app/forms` is a SvelteKit virtual module: it resolves inside a SvelteKit
 * build (which compiles this package, as it does every `svelte`-condition
 * dependency), never from Node on its own. That is why this lives in the
 * `/kit` entry and nowhere the framework-neutral bindings can reach.
 *
 * @copyright Thomas Foster
 * @module effect-forms-svelte/kit/Enhance
 */

/// <reference types="@sveltejs/kit" />

import { enhance } from "$app/forms";
import { type Attachment, createAttachmentKey } from "svelte/attachments";
import { applyActionResult, type ServerStateTarget } from "../SvelteKit.ts";

/**
 * The store {@link enhanceForm} drives: its `submitting` flag plus the
 * failure write {@link applyActionResult} makes (every `FormStore` is one).
 */
export interface EnhanceTarget<A> extends ServerStateTarget<A> {
  submitting: boolean;
}

/** The spreadable `<form>` props: the POST method plus the enhance attachment under its symbol key. */
export interface EnhancedFormProps {
  readonly method: "post";
  readonly [attachmentKey: symbol]: Attachment<HTMLFormElement>;
}

/**
 * Spreadable `<form>` props wiring SvelteKit's native `enhance` to the store:
 * `method="post"` plus a Svelte attachment that flips `submitting`, applies a
 * validation failure back to the store, and then always runs SvelteKit's
 * default `update` (with `reset: false`), which applies the result to
 * `page.form` / `page.status` exactly once. So a validation failure replaces
 * whatever `page.form` an earlier submit left (a `fail(500, { message })`, say)
 * instead of leaving it on screen beside the new field errors.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { createForm } from "@thomasfosterau/effect-forms-svelte";
 *   import { enhanceForm } from "@thomasfosterau/effect-forms-svelte/kit";
 *   let { data } = $props();
 *   const form = createForm(data.form);
 * </script>
 *
 * <form {...enhanceForm(form)}>…</form>
 * ```
 */
export function enhanceForm<A>(form: EnhanceTarget<A>): EnhancedFormProps {
  return {
    method: "post",
    [createAttachmentKey()]: (node: HTMLFormElement) => {
      const enhanced = enhance(node, () => {
        form.submitting = true;
        return async ({ result, update }) => {
          form.submitting = false;
          applyActionResult(form, result);
          await update({ reset: false });
        };
      });
      return () => enhanced.destroy();
    },
  };
}
