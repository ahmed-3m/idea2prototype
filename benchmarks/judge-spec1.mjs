// Spec-1 functional rubric judge — the exact script used for the archived
// 2026-10-18 paired run (benchmarks/runs/2026-10-18-spec1-paired/NOTES.md).
// Rubric pre-registered in benchmarks/specs.md; criteria are binary and
// exercised mechanically over HTTP.
// Usage: node judge-spec1.mjs <projectDir> <port>
const [projectDir, portArg] = process.argv.slice(2);
const port = Number(portArg);
const base = `http://127.0.0.1:${port}`;

import { spawn } from 'node:child_process';

function start() {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: projectDir,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });
  return child;
}

async function waitReady(deadlineMs = 15_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      await fetch(base);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return false;
}

const results = [];
const check = (name, ok) => { results.push([name, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };

const child = start();
try {
  check('app starts using its documented command', await waitReady());

  const add = await fetch(`${base}/api/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'rubric-A' }),
  });
  const item = await add.json();
  check('can add an item via the API', add.status === 201 || add.status === 200);

  const put = await fetch(`${base}/api/todos/${item.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ done: true }),
  });
  const updated = await put.json();
  check('can complete/check an item', put.status === 200 && updated.done === true);

  await fetch(`${base}/api/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'rubric-B' }),
  });

  const del = await fetch(`${base}/api/todos/${item.id}`, { method: 'DELETE' });
  check('can delete an item', del.status === 200 || del.status === 204);
} catch (err) {
  check('rubric flow threw', false);
  console.error(err);
} finally {
  child.kill();
  await new Promise((r) => setTimeout(r, 500));
}

// restart — persistence
const child2 = start();
try {
  await waitReady();
  const list = await (await fetch(`${base}/api/todos`)).json();
  const b = list.some((t) => t.text === 'rubric-B');
  const aGone = !list.some((t) => t.text === 'rubric-A');
  check('items still present after app restart (persistence)', b && aGone);
} catch {
  check('items still present after app restart (persistence)', false);
} finally {
  child2.kill();
}

const score = results.filter(([, ok]) => ok).length;
console.log(`SCORE ${score}/${results.length}`);
