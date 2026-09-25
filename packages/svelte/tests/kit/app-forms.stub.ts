/**
 * A stand-in for SvelteKit's `$app/forms` virtual module (aliased in
 * `vite.config.ts`): `enhance` records the submit callback so a test can
 * drive it, `applyAction` records what it was handed.
 */
import { vi } from "vite-plus/test";

type Submit = (input: unknown) => unknown;

export const enhanced: Array<{ node: HTMLFormElement; submit: Submit }> = [];

export const enhance = vi.fn((node: HTMLFormElement, submit: Submit) => {
  enhanced.push({ node, submit });
  return { destroy: vi.fn() };
});

export const applyAction = vi.fn(async (_result: unknown) => {});
