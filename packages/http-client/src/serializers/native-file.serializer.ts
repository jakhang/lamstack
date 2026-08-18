import type { FileSerializer } from './file-serializer';

interface NativeFile {
  uri: string;
  type?: string;
  name?: string;
  fileName?: string;
}

// The URI schemes React Native's own image/document/camera pickers actually produce.
// Deliberately a whitelist, not "any string" — `typeof uri === 'string'` alone would
// also misdetect an unrelated domain object that happens to have a `uri` field (e.g. a
// music-library payload like `{ uri: 'spotify:track:...' }`) as a file to upload.
const NATIVE_FILE_URI = /^(file|content|ph|assets-library|data|https?):/i;

function isNativeFile(value: unknown): value is NativeFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { uri?: unknown }).uri === 'string' &&
    NATIVE_FILE_URI.test((value as { uri: string }).uri)
  );
}

/**
 * Handles React Native's `{ uri, type?, name? }` file shape — that runtime has
 * no `File`/`Blob`. Its `FormData` polyfill accepts this object shape
 * directly (unlike the spec-compliant `FormData` used elsewhere), which is
 * why `serialize()` appends it as-is rather than converting to a `Blob`.
 *
 * `accepts()` is a heuristic, not a type check: it only recognizes the URI schemes
 * React Native's pickers actually produce (`file:`, `content:`, `ph:`,
 * `assets-library:`, `data:`, `http(s):`). A custom scheme from your own native module
 * won't be recognized — write your own `FileSerializer` for that case instead of
 * widening this one, since a looser predicate risks misdetecting an unrelated object
 * that happens to have a `uri` string field as a file.
 */
export class NativeFileSerializer implements FileSerializer {
  accepts(value: unknown): boolean {
    return isNativeFile(value);
  }

  serialize(formData: FormData, key: string, value: unknown): void {
    const file = value as NativeFile;
    formData.append(key, {
      uri: file.uri,
      type: file.type || 'application/octet-stream',
      name: file.name || file.fileName || 'upload.bin',
    } as unknown as Blob);
  }
}
