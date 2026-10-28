import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { guide, verifyLive } from '../scripts/docs.mjs';
test('live publication gate rejects wrong version, stale content and unavailable site', async () => {
  const original = globalThis.fetch;
  const { metadata } = guide();
  try {
    for (const data of [{ ...metadata, pluginVersion: '0.0.0' }, { ...metadata, docsSha256: 'bad' }]) {
      globalThis.fetch = async () => new Response(JSON.stringify(data));
      await assert.rejects(verifyLive(), /differs/);
    }
    globalThis.fetch = async () => new Response('', { status: 503 });
    await assert.rejects(verifyLive(), /unavailable/);
    globalThis.fetch = async () => new Response(JSON.stringify(metadata));
    await verifyLive();
  } finally { globalThis.fetch = original; }
});
test('sync copies exact public documentation, is repeatable and leaves unrelated files alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ucit-docs-'));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'folio-studio' }));
    fs.writeFileSync(path.join(dir, 'private-draft.json'), 'untouched');
    const script = new URL('../scripts/docs.mjs', import.meta.url);
    for (let n = 0; n < 2; n++) execFileSync(process.execPath, [script.pathname, 'sync', dir]);
    const dest = path.join(dir, 'apps/site/src/content/ucit');
    assert.deepEqual(fs.readFileSync(path.join(dest, 'usage.json')), guide().bytes);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dest, 'version.json'))), guide().metadata);
    assert.equal(fs.readFileSync(path.join(dir, 'private-draft.json'), 'utf8'), 'untouched');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
