/**
 * A stand-in for SvelteKit's `$app/forms` virtual module (aliased in
 * `vite.config.ts`): `enhance` records the submit callback so a test can
 * drive it, `applyAction` records what it was handed.
 */
import type { ActionResult, SubmitFunction } from "$app/forms";
import { vi } from "vite-plus/test";

type Submit = SubmitFunction;

export const enhanced: Array<{ node: HTMLFormElement; submit: Submit }> = [];

export const enhance = vi.fn<(node: HTMLFormElement, submit: Submit) => { destroy: () => void }>(
  (node, submit) => {
    enhanced.push({ node, submit });
    return { destroy: vi.fn<() => void>() };
  },
);

export const applyAction = vi.fn<(result: ActionResult) => Promise<void>>(async () => {});
