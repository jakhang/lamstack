/**
 * Runs `fn` with a fresh `AbortSignal`, returning both the resulting promise
 * and a `cancel()` to abort it — e.g. for a React `useEffect` cleanup, or a
 * user-initiated "cancel" button. Standalone rather than a client method:
 * `AbortSignal` is already first-class on `HttpRequestInit.signal`, so this
 * is just a small ergonomic wrapper, not something specific to `HttpClient`.
 */
export function cancelable<T>(fn: (signal: AbortSignal) => Promise<T>): {
  promise: Promise<T>;
  cancel: (reason?: string) => void;
} {
  const controller = new AbortController();
  const promise = fn(controller.signal);
  const cancel = (reason?: string) => controller.abort(reason);
  return { promise, cancel };
}
