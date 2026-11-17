// Lightweight pub/sub event bus for decoupled studio modules

class EventManager {
  constructor() {
    this._listeners = new Map();
  }

  on(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  once(event, handler) {
    const wrapped = (payload) => {
      this.off(event, wrapped);
      handler(payload);
    };
    return this.on(event, wrapped);
  }

  off(event, handler) {
    const set = this._listeners.get(event);
    if (set) {
      set.delete(handler);
    }
  }

  emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[EventManager] Error in listener for "${event}":`, err);
      }
    }
  }
}

export const events = new EventManager();
