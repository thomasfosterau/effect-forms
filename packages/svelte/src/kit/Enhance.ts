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
import type { FormStore } from "../FormStore.svelte.ts";
import { applyActionResult } from "../SvelteKit.ts";

/** The spreadable `<form>` props: the POST method plus the enhance attachment under its symbol key. */
export interface EnhancedFormProps {
  readonly method: "post";
  readonly [attachmentKey: symbol]: Attachment<HTMLFormElement>;
}

/**
 * Spreadable `<form>` props wiring SvelteKit's native `enhance` to the store:
 * `method="post"` plus a Svelte attachment that flips `submitting`, applies a
 * validation failure back to the store, and otherwise defers to SvelteKit's
 * default `update` (with `reset: false`) for success / redirect / error, which
 * applies the result exactly once.
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
export function enhanceForm(
  // oxlint-disable-next-line typescript/no-explicit-any -- accepts any concrete store
  form: FormStore<any, any, any>,
): EnhancedFormProps {
  return {
    method: "post",
    [createAttachmentKey()]: (node: HTMLFormElement) => {
      const enhanced = enhance(node, () => {
        form.submitting = true;
        return async ({ result, update }) => {
          form.submitting = false;
          if (applyActionResult(form, result)) return;
          await update({ reset: false });
        };
      });
      return () => enhanced.destroy();
    },
  };
}
