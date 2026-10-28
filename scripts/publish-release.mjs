// Canonical release entrypoint. Never creates a release with stale live documentation.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { guide, verifyLive } from './docs.mjs';
const cwd = fileURLToPath(new URL('../', import.meta.url));
const run = (cmd, args, capture=false) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: capture ? ['ignore','pipe','inherit'] : 'inherit' });
const { doc } = guide();
if (run('git', ['status', '--porcelain'], true).trim()) throw Error('Commit the tested release source before publication.');
const sha = run('git', ['rev-parse', 'HEAD'], true).trim();
const remote = run('git', ['ls-remote', 'origin', 'refs/heads/main'], true).split(/\s/)[0];
if (sha !== remote) throw Error('Push this exact source commit to GitHub main first.');
run('npm', ['run', 'check']);
run('npm', ['test']);
run('npm', ['run', 'package']);
await verifyLive();
run('gh', ['release', 'create', doc.pluginVersion, 'dist/main.js', 'dist/manifest.json', 'dist/styles.css', 'dist/ucit-home.zip', 'dist/usage.json', 'dist/SHA256SUMS', '--repo', 'jasonshelter0/obsidian-ucit-home', '--target', sha, '--title', `UCIT Home ${doc.pluginVersion}`, '--notes-file', 'CHANGELOG.md']);
