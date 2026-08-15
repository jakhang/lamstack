import type { HeadersInput, HttpHeaders } from './types';

/**
 * Merges header layers left-to-right: later layers win. Every key is lowercased; a
 * `null`/`undefined` value deletes a key set by an earlier layer instead of setting it
 * to the string `"null"`/`"undefined"`.
 */
export function mergeHeaders(...layers: (HeadersInput | undefined)[]): HttpHeaders {
  const merged: Record<string, string> = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      const lowerKey = key.toLowerCase();
      if (value === null || value === undefined) {
        delete merged[lowerKey];
      } else {
        merged[lowerKey] = String(value);
      }
    }
  }
  return merged;
}
