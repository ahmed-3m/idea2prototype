import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, memoAsync } from '../index.mjs';

test('createStore: set merges patches and notifies subscribers', () => {
  const seen = [];
  const store = createStore({ count: 0, label: 'items' });
  const unsubscribe = store.subscribe((state) => seen.push(state.count));
  assert.equal(store.get().count, 0);

  store.set({ count: 1 });
  store.set((state) => ({ count: state.count + 1 }));
  assert.deepEqual(store.get(), { count: 2, label: 'items' });

  unsubscribe();
  store.set({ count: 99 });
  assert.equal(store.get().count, 99);
  assert.deepEqual(seen, [1, 2]); // unsubscribed listeners stop firing
});

test('createStore: function updates receive the current state', () => {
  const store = createStore({ total: 10 });
  store.set((state) => ({ total: state.total * 2 }));
  assert.equal(store.get().total, 20);
});

test('memoAsync: caches by arguments until cleared', async () => {
  let calls = 0;
  const fetchUser = memoAsync(async (id) => {
    calls += 1;
    return { id };
  });

  assert.deepEqual(await fetchUser('a'), { id: 'a' });
  await fetchUser('a'); // cache hit
  await fetchUser('b'); // different key
  assert.equal(calls, 2);

  fetchUser.clear();
  await fetchUser('a');
  assert.equal(calls, 3);
});

test('memoAsync: rejections are not cached', async () => {
  let calls = 0;
  const boom = memoAsync(async () => {
    calls += 1;
    throw new Error('nope');
  });
  await assert.rejects(boom(), /nope/);
  await assert.rejects(boom(), /nope/);
  assert.equal(calls, 2);
});

test('memoAsync: undefined arguments are rejected, never aliased to null', async () => {
  const fn = memoAsync(async (x) => x);
  await assert.rejects(fn(undefined), TypeError);
  assert.equal(await fn(null), null); // null itself stays a valid argument
});
