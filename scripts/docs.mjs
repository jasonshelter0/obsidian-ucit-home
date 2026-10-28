import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
export function guide() {
  const bytes = fs.readFileSync(path.join(root, 'docs/usage.json'));
  const doc = JSON.parse(bytes);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  if (doc.schemaVersion !== 1 || doc.pluginVersion !== manifest.version) throw Error('Guide/manifest version mismatch.');
  const ids = ['install', 'start', 'routine', 'calendar', 'fields', 'help', 'updates'];
  for (const locale of ['zh-CN', 'en', 'fr']) {
    const c = doc.locales[locale];
    if (!c?.title || !c.summary || Object.values(c.labels).some(s => typeof s !== 'string' || !s.trim())) throw Error(`Incomplete guide: ${locale}`);
    if (c.sections.map(s => s.id).join() !== ids.join() || c.sections.some(s => !s.title || !s.body)) throw Error(`Incomplete sections: ${locale}`);
    if (c.states.map(s => s.code).join('') !== 'PAWSC' || c.states.some(s => !s.name || !s.body)) throw Error(`Incomplete states: ${locale}`);
  }
  return { bytes, doc, metadata: { schemaVersion: 1, pluginVersion: doc.pluginVersion, docsSha256: crypto.createHash('sha256').update(bytes).digest('hex'), repository: doc.repository, updated: doc.updated } };
}
export async function verifyLive() {
  const { metadata } = guide();
  const response = await fetch('https://www.jasonshelter.com/projects/ucit-home/version.json', { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error(`Live guide unavailable (${response.status}). Deploy the website first.`);
  const live = await response.json();
  if (live.pluginVersion !== metadata.pluginVersion || live.docsSha256 !== metadata.docsSha256) throw Error('Live guide differs from this release. Sync, preview and deploy the website before publishing.');
  console.log(`Live UCIT guide verified: ${metadata.pluginVersion} / ${metadata.docsSha256}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] || 'check';
  if (mode === 'live') await verifyLive();
  else if (mode === 'sync') {
    if (!process.argv[3]) throw Error('Usage: npm run docs:sync -- /absolute/path/to/personal-website');
    const target = path.resolve(process.argv[3]);
    const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json')));
    if (pkg.name !== 'folio-studio') throw Error('Target must be the Folio Studio website repository.');
    const { bytes, metadata } = guide();
    const dest = path.join(target, 'apps/site/src/content/ucit');
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'usage.json'), bytes);
    fs.writeFileSync(path.join(dest, 'version.json'), JSON.stringify(metadata, null, 2) + '\n');
    console.log('Synced UCIT guide and fingerprint. Run website checks, preview and deployment next.');
  } else if (mode === 'check') { guide(); console.log('UCIT guide: three locales and plugin version verified.'); }
  else throw Error(`Unknown documentation command: ${mode}`);
}
