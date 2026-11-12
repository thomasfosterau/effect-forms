---
"@thomasfosterau/effect-forms-svelte": minor
---

**Breaking:** the `/kit` form-state readers model "no submission" as `Option`. `formStateOf(form)` answers `Option<ActionFormState>` (`None` for a first render, a redirecting success, or a result that carried no form state) instead of `ActionFormState | undefined`, and `issuesFor`, `rootIssuesOf` and `valueOf` take that `Option`. A template that passes `formStateOf(form)` straight to the readers is unchanged; a call that passed `undefined` passes `Option.none()`.
