// Idea2Prototype feature: validation — request body validation & handler wrapper.
// Zero dependencies. Pure ESM.
//
// Contract:
//   validate(body, schema) -> null when valid, or [400, { error: '...' }]
//   validated(schema)      -> handler wrapper checking ctx.body before execution
//
// Schema format:
//   Flat object mapping field name to type tag:
//     'string' | 'number' | 'boolean' | 'array'
//   Append '?' for optional fields (e.g. 'number?').
//
// Policies:
//   - Non-object bodies: rejects null, primitives, and arrays with
//     [400, { error: 'JSON object body required' }].
//   - Unknown keys: rejects unrecognized fields with
//     [400, { error: 'unknown field "<key>"' }] to protect prototypes from typos.
//   - Missing fields: required fields missing from body fail with
//     [400, { error: 'field "<key>" is required' }].
//   - Type mismatch: invalid field types fail with
//     [400, { error: 'field "<key>" must be a <type>' }] (or 'an array').
//   - Null values: null never satisfies a field, even an optional one —
//     send the field with a valid value or omit it entirely.
//
// Usage:
//   // Inline:
//   const bad = validate(body, { title: 'string', count: 'number?' });
//   if (bad) return bad;
//
//   // Wrapper composition (rateLimit / cors / requireAuth pattern):
//   POST: validated({ title: 'string' })(async (ctx) => [201, { ok: true }])

function checkType(val, type) {
  if (type === 'string') return typeof val === 'string';
  if (type === 'number') return typeof val === 'number' && Number.isFinite(val);
  if (type === 'boolean') return typeof val === 'boolean';
  if (type === 'array') return Array.isArray(val);
  return false;
}

/**
 * Validate a request body against a flat type schema.
 * Returns null when valid, or a ready-to-return route tuple [400, { error }].
 */
export function validate(body, schema) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return [400, { error: 'JSON object body required' }];
  }

  for (const [key, tag] of Object.entries(schema)) {
    const isOptional = tag.endsWith('?');
    const expected = isOptional ? tag.slice(0, -1) : tag;
    // own-property read: a schema field named like an Object.prototype member
    // ("toString", "valueOf", ...) must read as absent when the body omits it,
    // not as the inherited function.
    const val = Object.prototype.hasOwnProperty.call(body, key) ? body[key] : undefined;
    if (val === undefined) {
      if (!isOptional) {
        return [400, { error: `field "${key}" is required` }];
      }
    } else if (!checkType(val, expected)) {
      const article = expected === 'array' ? 'an' : 'a';
      return [400, { error: `field "${key}" must be ${article} ${expected}` }];
    }
  }

  for (const key of Object.keys(body)) {
    if (!Object.prototype.hasOwnProperty.call(schema, key)) {
      return [400, { error: `unknown field "${key}"` }];
    }
  }

  return null;
}

/**
 * Wrap a route handler with schema validation on ctx.body.
 * Returns [400, { error }] on validation failure without calling the handler.
 */
export function validated(schema) {
  return (handler) => async (ctx) => {
    const bad = validate(ctx?.body, schema);
    if (bad) return bad;
    return await handler(ctx);
  };
}
