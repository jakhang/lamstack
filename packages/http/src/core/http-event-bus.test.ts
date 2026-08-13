import { describe, expect, it, vi } from 'vitest';
import { HttpEventBus } from './http-event-bus';
import { HttpError } from './http-error';
import { resolve } from './resolve';

describe('HttpEventBus', () => {
  it('delivers an emitted event to a subscribed listener', () => {
    const bus = new HttpEventBus();
    const listener = vi.fn();
    bus.on('token:refreshed', listener);

    bus.emit('token:refreshed', {});

    expect(listener).toHaveBeenCalledWith({});
  });

  it('delivers to every listener subscribed to the same event', () => {
    const bus = new HttpEventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('token:refreshed', a);
    bus.on('token:refreshed', b);

    bus.emit('token:refreshed', {});

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('does not deliver to a listener subscribed to a different event', () => {
    const bus = new HttpEventBus();
    const listener = vi.fn();
    bus.on('token:refreshed', listener);

    bus.emit('token:refresh-failed', { error: new Error('x') });

    expect(listener).not.toHaveBeenCalled();
  });

  it('on() returns an unsubscribe function; calling it stops further delivery', () => {
    const bus = new HttpEventBus();
    const listener = vi.fn();
    const unsubscribe = bus.on('token:refreshed', listener);

    unsubscribe();
    bus.emit('token:refreshed', {});

    expect(listener).not.toHaveBeenCalled();
  });

  it('off() unsubscribes a specific listener without affecting others', () => {
    const bus = new HttpEventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('token:refreshed', a);
    bus.on('token:refreshed', b);

    bus.off('token:refreshed', a);
    bus.emit('token:refreshed', {});

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('emits unauthorized with the HttpError payload', () => {
    const bus = new HttpEventBus();
    const listener = vi.fn();
    bus.on('unauthorized', listener);
    const error = new HttpError('Unauthorized', { code: 'HTTP_ERROR', status: 401, request: resolve({ url: '/x' }) });

    bus.emit('unauthorized', { error });

    expect(listener).toHaveBeenCalledWith({ error });
  });

  it('a throwing listener does not prevent other listeners for the same event from running', () => {
    const bus = new HttpEventBus();
    const throwing = vi.fn(() => {
      throw new Error('boom');
    });
    const after = vi.fn();
    bus.on('token:refreshed', throwing);
    bus.on('token:refreshed', after);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    bus.emit('token:refreshed', {});

    expect(after).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('clearAll() removes every listener for every event', () => {
    const bus = new HttpEventBus();
    const listener = vi.fn();
    bus.on('token:refreshed', listener);

    bus.clearAll();
    bus.emit('token:refreshed', {});

    expect(listener).not.toHaveBeenCalled();
  });
});
