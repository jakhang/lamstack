import { describe, expect, it } from 'vitest';
import { WebFileSerializer } from './web-file.serializer';

describe('WebFileSerializer', () => {
  const serializer = new WebFileSerializer();

  it('accepts a File', () => {
    expect(serializer.accepts(new File(['x'], 'a.txt'))).toBe(true);
  });

  it('accepts a Blob', () => {
    expect(serializer.accepts(new Blob(['x']))).toBe(true);
  });

  it('rejects a plain object', () => {
    expect(serializer.accepts({ uri: 'file://x' })).toBe(false);
  });

  it('rejects a string', () => {
    expect(serializer.accepts('not a file')).toBe(false);
  });

  it('appends the file as-is to FormData', () => {
    const formData = new FormData();
    const file = new File(['x'], 'a.txt');
    serializer.serialize(formData, 'avatar', file);
    expect(formData.get('avatar')).toBe(file);
  });
});
