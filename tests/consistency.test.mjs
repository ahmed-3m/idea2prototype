// Version-consistency guard: the engine version is duplicated across 8 in-repo
// fields (engine const, package.json, plugin manifest, every template marker)
// plus a CHANGELOG section — this test turns that manual checklist into a
// failing test so drift can't ship.
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

const engineSource = await readFile(
  join(ROOT, 'skills/idea2prototype/scripts/idea2prototype.mjs'),
  'utf8',
);
const VERSION = /const VERSION = '([^']+)'/.exec(engineSource)?.[1];

test('engine VERSION is extractable', () => {
  assert.ok(/^\d+\.\d+\.\d+$/.test(VERSION ?? ''), `got: ${VERSION}`);
});

test('package.json, plugin manifest, and template markers match the engine version', async () => {
  const packageJson = await readJson(join(ROOT, 'package.json'));
  assert.equal(packageJson.version, VERSION, 'package.json .version drifted');

  const pluginJson = await readJson(join(ROOT, '.zcode-plugin/plugin.json'));
  assert.equal(pluginJson.version, VERSION, '.zcode-plugin/plugin.json .version drifted');

  const templatesDir = join(ROOT, 'skills/idea2prototype/templates');
  const templates = (await readdir(templatesDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && d.name !== 'features')
    .map((d) => d.name);
  assert.ok(templates.length >= 5, `expected >=5 templates, found: ${templates.join(', ')}`);
  for (const name of templates) {
    const marker = await readJson(join(templatesDir, name, '.idea2prototype.json'));
    assert.equal(marker.version, VERSION, `templates/${name}/.idea2prototype.json .version drifted`);
  }
});

test('CHANGELOG has a section for the current version', async () => {
  const changelog = await readFile(join(ROOT, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, new RegExp(`^## ${VERSION.replace(/\./g, '\\.')}\\s*$`, 'm'));
});

test('every package.json files[] entry exists in the repo', async () => {
  const packageJson = await readJson(join(ROOT, 'package.json'));
  assert.ok(packageJson.files.length > 0);
  const entries = packageJson.files.filter((f) => !f.startsWith('!'));
  for (const entry of entries) {
    await assert.doesNotReject(
      () => access(join(ROOT, entry)),
      `"${entry}" is in the npm files manifest but does not exist`,
    );
  }
});

test('the npm bin target exists', async () => {
  const packageJson = await readJson(join(ROOT, 'package.json'));
  for (const target of Object.values(packageJson.bin ?? {})) {
    await assert.doesNotReject(
      () => access(join(ROOT, target)),
      `bin target "${target}" does not exist`,
    );
  }
});
