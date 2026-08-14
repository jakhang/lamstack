/** Strategy for appending a non-primitive value (a `File`/`Blob`, or a platform-specific file shape) to a `FormData`. */
export interface FileSerializer {
  /** Whether this serializer knows how to handle `value`. */
  accepts(value: unknown): boolean;
  /** Appends `value` under `key`, in whatever shape the target `FormData` implementation expects. */
  serialize(formData: FormData, key: string, value: unknown): void;
}
