import { describe, expect, it } from 'vitest';
import { FormBuilder } from './form-builder';
import { WebFileSerializer } from './web-file.serializer';

describe('FormBuilder', () => {
  const builder = new FormBuilder(new WebFileSerializer());

  it('stringifies primitive values', () => {
    const formData = builder.build({ name: 'a', count: 3, active: true });
    expect(formData.get('name')).toBe('a');
    expect(formData.get('count')).toBe('3');
    expect(formData.get('active')).toBe('true');
  });

  it('serializes a Date as an ISO string', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    const formData = builder.build({ when: date });
    expect(formData.get('when')).toBe(date.toISOString());
  });

  it('repeats the key for each array item', () => {
    const formData = builder.build({ tag: ['a', 'b', 'c'] });
    expect(formData.getAll('tag')).toEqual(['a', 'b', 'c']);
  });

  it('JSON-stringifies a nested plain object', () => {
    const formData = builder.build({ meta: { a: 1, b: 'x' } });
    expect(formData.get('meta')).toBe(JSON.stringify({ a: 1, b: 'x' }));
  });

  it('omits undefined and null values entirely', () => {
    const formData = builder.build({ a: undefined, b: null, c: 'kept' });
    expect(formData.has('a')).toBe(false);
    expect(formData.has('b')).toBe(false);
    expect(formData.get('c')).toBe('kept');
  });

  it('delegates a File value to the configured FileSerializer', () => {
    const file = new File(['content'], 'a.txt', { type: 'text/plain' });
    const formData = builder.build({ avatar: file });
    expect(formData.get('avatar')).toBe(file);
  });

  it('builds a mixed object (string, number, Date, array, nested object, a File) with every key present and correctly serialized', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    const file = new File(['content'], 'a.txt', { type: 'text/plain' });

    const formData = builder.build({
      name: 'a',
      count: 3,
      when: date,
      tags: ['x', 'y'],
      meta: { nested: true },
      avatar: file,
    });

    expect(formData.get('name')).toBe('a');
    expect(formData.get('count')).toBe('3');
    expect(formData.get('when')).toBe(date.toISOString());
    expect(formData.getAll('tags')).toEqual(['x', 'y']);
    expect(formData.get('meta')).toBe(JSON.stringify({ nested: true }));
    expect(formData.get('avatar')).toBe(file);
  });
});
