import { describe, expect, it, vi } from 'vitest';
import { NativeFileSerializer } from './native-file.serializer';

describe('NativeFileSerializer', () => {
  const serializer = new NativeFileSerializer();

  it('accepts a { uri } object (React Native\'s file shape)', () => {
    expect(serializer.accepts({ uri: 'file://photo.jpg' })).toBe(true);
  });

  it('rejects a value without a string uri', () => {
    expect(serializer.accepts({ name: 'x' })).toBe(false);
    expect(serializer.accepts({ uri: 123 })).toBe(false);
    expect(serializer.accepts('file://x')).toBe(false);
    expect(serializer.accepts(null)).toBe(false);
  });

  // Node's spec-compliant FormData stringifies a plain object passed to append(), unlike
  // React Native's own polyfill — so this asserts on the call, not a real FormData round-trip.
  it('appends a normalized { uri, type, name } object, defaulting type/name when absent', () => {
    const append = vi.fn();
    const formData = { append } as unknown as FormData;

    serializer.serialize(formData, 'avatar', { uri: 'file://photo.jpg' });

    expect(append).toHaveBeenCalledWith('avatar', {
      uri: 'file://photo.jpg',
      type: 'application/octet-stream',
      name: 'upload.bin',
    });
  });

  it('preserves an explicit type/name instead of the defaults', () => {
    const append = vi.fn();
    const formData = { append } as unknown as FormData;

    serializer.serialize(formData, 'avatar', { uri: 'file://photo.jpg', type: 'image/jpeg', name: 'photo.jpg' });

    expect(append).toHaveBeenCalledWith('avatar', {
      uri: 'file://photo.jpg',
      type: 'image/jpeg',
      name: 'photo.jpg',
    });
  });

  it('falls back to fileName when name is absent', () => {
    const append = vi.fn();
    const formData = { append } as unknown as FormData;

    serializer.serialize(formData, 'avatar', { uri: 'file://photo.jpg', fileName: 'from-camera.jpg' });

    expect(append).toHaveBeenCalledWith(
      'avatar',
      expect.objectContaining({ name: 'from-camera.jpg' }),
    );
  });
});
