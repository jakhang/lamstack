import { describe, expect, it, vi } from 'vitest';
import { EventBus } from './event-bus';

type TestEventMap = {
  ping: { count: number };
  failed: { error: unknown };
};

describe('EventBus', () => {
  it('delivers an emitted event to a subscribed listener', () => {
    const bus = new EventBus<TestEventMap>();
    const listener = vi.fn();
    bus.on('ping', listener);

    bus.emit('ping', { count: 1 });

    expect(listener).toHaveBeenCalledWith({ count: 1 });
  });

  it('delivers to every listener subscribed to the same event', () => {
    const bus = new EventBus<TestEventMap>();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('ping', a);
    bus.on('ping', b);

    bus.emit('ping', { count: 1 });

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('does not deliver to a listener subscribed to a different event', () => {
    const bus = new EventBus<TestEventMap>();
    const listener = vi.fn();
    bus.on('ping', listener);

    bus.emit('failed', { error: new Error('x') });

    expect(listener).not.toHaveBeenCalled();
  });

  it('on() returns an unsubscribe function; calling it stops further delivery', () => {
    const bus = new EventBus<TestEventMap>();
    const listener = vi.fn();
    const unsubscribe = bus.on('ping', listener);

    unsubscribe();
    bus.emit('ping', { count: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it('off() unsubscribes a specific listener without affecting others', () => {
    const bus = new EventBus<TestEventMap>();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('ping', a);
    bus.on('ping', b);

    bus.off('ping', a);
    bus.emit('ping', { count: 1 });

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('a throwing listener does not prevent other listeners for the same event from running', () => {
    const bus = new EventBus<TestEventMap>();
    const throwing = vi.fn(() => {
      throw new Error('boom');
    });
    const after = vi.fn();
    bus.on('ping', throwing);
    bus.on('ping', after);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    bus.emit('ping', { count: 1 });

    expect(after).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('clearAll() removes every listener for every event', () => {
    const bus = new EventBus<TestEventMap>();
    const listener = vi.fn();
    bus.on('ping', listener);

    bus.clearAll();
    bus.emit('ping', { count: 1 });

    expect(listener).not.toHaveBeenCalled();
  });
});
