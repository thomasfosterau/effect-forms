---
"@thomasfosterau/effect-forms-svelte": minor
---

`FormStore`'s default submit POSTs through Effect's `HttpClient` (`effect/http`, on the platform `fetch` through `FetchHttpClient`) instead of calling `fetch` directly. The submission (`handler`, `submit` or the default POST, then `onResult` and the update) runs as one Effect on a store-owned `ManagedRuntime`, so an `HttpClient` in the store's `layer` doesn't reroute the default POST.

The request is the same: the form body, `Accept: application/json`, and no `traceparent` / `b3` headers. `submitting`, `delayed`, `onResult` and `onError` behave as before, and a network failure still reports `fetch`'s own rejection message.

One visible change: when the response body isn't JSON, the `Error` result's `message` is now always `"Request failed"`. It used to be the response's `statusText` when that was non-empty. Effect's `HttpClientResponse` doesn't expose `statusText` at the `effect` 4.0 peer floor. Over HTTP/2 and HTTP/3, `statusText` is always empty, so the message there was already `"Request failed"`. `status` is unchanged.

Bundle cost: the `effect/http` client modules add about 40 KB minified (about 13.5 KB gzipped) to a consumer bundle that includes the store.
