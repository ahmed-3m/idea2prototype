// Stress driver: boots a scaffolded project's server in its OWN process (cwd =
// the project) and holds it until stdin closes. Then it closes the app and
// lets the event loop drain — deliberately WITHOUT process.exit, so a leaked
// timer or socket shows up as a process that never exits, and a crash shows
// up as a process that exits before stdin closed.
// Protocol: first stdout line is {"port":N}; "closed" after app.close().
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { start } = await import(pathToFileURL(join(process.cwd(), 'server.mjs')).href);
const app = await start(0);
process.stdout.write(`${JSON.stringify({ port: app.port })}\n`);

process.stdin.resume();
process.stdin.on('end', async () => {
  process.stdin.destroy(); // the stdin pipe itself must not keep the loop alive
  await app.close();
  process.stdout.write('closed\n');
});
