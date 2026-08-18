import type { FileSerializer } from './file-serializer';

/** Handles `File`/`Blob` values — the browser and Node Web-API file shape. */
export class WebFileSerializer implements FileSerializer {
  accepts(value: unknown): boolean {
    return (
      (typeof File !== 'undefined' && value instanceof File) ||
      (typeof Blob !== 'undefined' && value instanceof Blob)
    );
  }

  serialize(formData: FormData, key: string, value: unknown): void {
    formData.append(key, value as Blob);
  }
}
