import type { FileSerializer } from './file-serializer';

interface NativeFile {
  uri: string;
  type?: string;
  name?: string;
  fileName?: string;
}

function isNativeFile(value: unknown): value is NativeFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { uri?: unknown }).uri === 'string'
  );
}

/**
 * Handles React Native's `{ uri, type?, name? }` file shape — that runtime has
 * no `File`/`Blob`. Its `FormData` polyfill accepts this object shape
 * directly (unlike the spec-compliant `FormData` used elsewhere), which is
 * why `serialize()` appends it as-is rather than converting to a `Blob`.
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
