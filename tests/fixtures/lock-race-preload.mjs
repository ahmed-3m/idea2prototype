// Test-only preload (node --import): widens the project lock's two race
// windows so the takeover race is reproduced on purpose, not by CI luck.
//   1. create -> pid write: a new lock exists, EMPTY, for 40 ms.
//   2. "lock exists" -> judging it: after a failed create, pause up to 40 ms
//      so the holder may release before the waiter reads the lock.
// Only the exclusive (wx) create of *.lock paths is touched; the engine
// itself is unchanged.
import { createRequire, syncBuiltinESMExports } from 'node:module';

const fsp = createRequire(import.meta.url)('node:fs/promises');
const { open, writeFile } = fsp;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

fsp.writeFile = async (path, data, opts) => {
  if (!String(path).endsWith('.lock') || opts?.flag !== 'wx') return writeFile(path, data, opts);
  let fh;
  try {
    fh = await open(path, 'wx');
  } catch (err) {
    if (err?.code === 'EEXIST') await pause(Math.random() * 40);
    throw err;
  }
  try {
    await pause(40);
    await fh.writeFile(data);
  } finally {
    await fh.close();
  }
};
syncBuiltinESMExports();
