// {{name}} — library entry point. {{idea}}
// This module is the public API surface: everything exported here is what
// consumers import and what `npm run check` smoke-tests on boot.

/**
 * Tiny observable state container — enough state handling for a prototype
 * without pulling in a framework.
 */
export function createStore(initial = {}) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set(next) {
      const patch = typeof next === 'function' ? next(state) : next;
      state = { ...state, ...patch };
      for (const listener of listeners) listener(state);
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener); // call to unsubscribe
    },
  };
}

/**
 * Memoize an async function by its JSON-serialized arguments. Concurrent
 * calls share one in-flight promise; rejections are not cached.
 * `memoized.clear()` invalidates everything.
 */
export function memoAsync(fn) {
  const cache = new Map();
  const memoized = async (...args) => {
    const key = JSON.stringify(args);
    if (!cache.has(key)) {
      cache.set(key, fn(...args).catch((err) => {
        cache.delete(key);
        throw err;
      }));
    }
    return cache.get(key);
  };
  memoized.clear = () => cache.clear();
  return memoized;
}
