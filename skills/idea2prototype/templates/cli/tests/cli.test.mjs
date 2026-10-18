import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));

test('--help prints usage and exits 0', async () => {
  const { stdout } = await run(process.execPath, [cli, '--help']);
  assert.match(stdout, /Usage:/);
});

test('greet prints a greeting', async () => {
  const { stdout } = await run(process.execPath, [cli, 'greet', 'proto']);
  assert.match(stdout, /Hello, proto!/);
});

test('unknown command exits non-zero', async () => {
  await assert.rejects(run(process.execPath, [cli, 'bogus']), (err) => err.code !== 0);
});
