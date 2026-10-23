import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, validated } from '../validation.mjs';

const SCHEMA = {
  name: 'string',
  age: 'number?',
  active: 'boolean',
  tags: 'array',
};

test('validate(): valid body passes schema', () => {
  const result = validate({
    name: 'Alice',
    age: 30,
    active: true,
    tags: ['admin', 'user'],
  }, SCHEMA);
  assert.equal(result, null);
});

test('validate(): missing required field fails with 400', () => {
  const missingName = validate({ active: true, tags: [] }, SCHEMA);
  assert.deepEqual(missingName, [400, { error: 'field "name" is required' }]);

  const missingActive = validate({ name: 'Bob', tags: [] }, SCHEMA);
  assert.deepEqual(missingActive, [400, { error: 'field "active" is required' }]);
});

test('validate(): wrong type fails with 400', () => {
  assert.deepEqual(
    validate({ name: 123, active: true, tags: [] }, SCHEMA),
    [400, { error: 'field "name" must be a string' }],
  );
  assert.deepEqual(
    validate({ name: 'Bob', active: 'yes', tags: [] }, SCHEMA),
    [400, { error: 'field "active" must be a boolean' }],
  );
  assert.deepEqual(
    validate({ name: 'Bob', active: true, tags: 'not-array' }, SCHEMA),
    [400, { error: 'field "tags" must be an array' }],
  );
  assert.deepEqual(
    validate({ name: 'Bob', age: 'thirty', active: true, tags: [] }, SCHEMA),
    [400, { error: 'field "age" must be a number' }],
  );
});

test('validate(): optional field present or absent', () => {
  // Absent optional field
  assert.equal(validate({ name: 'Bob', active: false, tags: [] }, SCHEMA), null);
  // Present valid optional field
  assert.equal(validate({ name: 'Bob', age: 25, active: false, tags: [] }, SCHEMA), null);
});

test('validate(): unknown-key policy rejects extra fields', () => {
  const bad = validate({
    name: 'Bob',
    active: true,
    tags: [],
    extra: 'unexpected',
  }, SCHEMA);
  assert.deepEqual(bad, [400, { error: 'unknown field "extra"' }]);
});

test('validate(): non-object body rejected with 400', () => {
  for (const badBody of [null, undefined, 'string', 123, true, [1, 2, 3]]) {
    assert.deepEqual(
      validate(badBody, SCHEMA),
      [400, { error: 'JSON object body required' }],
    );
  }
});

test('validate(): null never satisfies a field, even an optional one', () => {
  assert.deepEqual(
    validate({ name: 'Bob', age: null, active: true, tags: [] }, SCHEMA),
    [400, { error: 'field "age" must be a number' }],
  );
});

test('validate(): non-finite numbers fail; __proto__ in a body is an unknown field', () => {
  for (const age of [NaN, Infinity, -Infinity]) {
    assert.deepEqual(
      validate({ name: 'Bob', age, active: true, tags: [] }, SCHEMA),
      [400, { error: 'field "age" must be a number' }],
    );
  }
  // JSON.parse makes "__proto__" an own key — it must be rejected as unknown,
  // never merged onto the object's prototype.
  const hostile = JSON.parse('{"name":"Bob","active":true,"tags":[],"__proto__":1}');
  assert.deepEqual(
    validate(hostile, SCHEMA),
    [400, { error: 'unknown field "__proto__"' }],
  );
});

test('validated(): wraps handler, returns 400 on invalid body without invoking handler', async () => {
  let handlerRan = false;
  const wrapped = validated(SCHEMA)(async () => {
    handlerRan = true;
    return [200, { ok: true }];
  });

  const res = await wrapped({ body: { name: 'Bob' } }); // missing active & tags
  assert.deepEqual(res, [400, { error: 'field "active" is required' }]);
  assert.equal(handlerRan, false);

  const nonObjRes = await wrapped({ body: null });
  assert.deepEqual(nonObjRes, [400, { error: 'JSON object body required' }]);
  assert.equal(handlerRan, false);
});

test('validated(): passes through to handler on valid body', async () => {
  let calledWith = null;
  const wrapped = validated(SCHEMA)(async (ctx) => {
    calledWith = ctx;
    return [201, { created: ctx.body.name }];
  });

  const ctx = {
    body: { name: 'Alice', active: true, tags: ['starter'] },
    user: { id: 42 },
  };
  const res = await wrapped(ctx);
  assert.deepEqual(res, [201, { created: 'Alice' }]);
  assert.equal(calledWith, ctx);
});
