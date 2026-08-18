import type { FileSerializer } from './file-serializer';

/**
 * Builds a `FormData` from a plain object: primitives are stringified,
 * `Date` values become ISO strings, arrays repeat the key (one `append` per
 * item), nested plain objects are JSON-stringified, and anything the
 * configured `FileSerializer` accepts (a `File`/`Blob`, or a platform file
 * shape) is delegated to it. `undefined`/`null` values are omitted entirely.
 */
export class FormBuilder {
  constructor(private readonly fileSerializer: FileSerializer) {}

  build(data: Record<string, unknown>): FormData {
    const formData = new FormData();

    for (const [key, value] of Object.entries(data)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) this.appendValue(formData, key, item);
      } else {
        this.appendValue(formData, key, value);
      }
    }

    return formData;
  }

  private appendValue(formData: FormData, key: string, value: unknown): void {
    if (value === undefined || value === null) return;

    if (this.fileSerializer.accepts(value)) {
      this.fileSerializer.serialize(formData, key, value);
    } else if (value instanceof Date) {
      formData.append(key, value.toISOString());
    } else if (typeof value !== 'object') {
      formData.append(key, String(value));
    } else {
      try {
        formData.append(key, JSON.stringify(value));
      } catch (error) {
        console.warn(`FormBuilder: cannot stringify key "${key}"`, error);
      }
    }
  }
}
