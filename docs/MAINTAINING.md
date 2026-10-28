# Release the plugin and its usage website together

Website: https://www.jasonshelter.com/en/projects/ucit-home/

`docs/usage.json` is the canonical multilingual usage guide. Do not edit the generated website copy. Each behavior change needs corresponding Chinese, English and French guide changes. `pluginVersion` must match `manifest.json`; keep `updated` accurate. Corrections can retain the plugin version.

1. Update code, tests, changelog, manifest/package/versions and all three guide languages.
2. Run `npm run check`, `npm test` and `npm run docs:check`.
3. Run `npm run docs:sync -- /path/to/personal-website`. This deterministically copies only the public guide and its SHA-256/version metadata. It neither reads a vault nor changes private website drafts.
4. Commit/push both reviewed repositories. In the website repository, run typecheck, tests, build and the UCIT browser checks. Follow its `AGENTS.md`, `docs/SUBPAGE_SYSTEM.md`, `RELEASE_HANDOFF.md` and the safe-production-deployment skill: real deployment lock, backup, immutable artifact, published-snapshot rebuild, authenticated preview, publication and verification.
5. Run `npm run docs:live` to check the deployed guide. Then run `npm run release:publish`. It verifies clean/pushed source, runs tests and packaging, checks the live guide version **and SHA-256**, and publishes the exact Git commit. Existing releases are not overwritten.

This is a repeatable, guarded release pipeline, not an unattended production deployer. The sync command automates content copying; website deployment still requires the established preview and lock process. A failed live check stops plugin publication. If plugin publication fails after the website was deployed, retry that publication or roll back the website using its release record. Direct `gh` commands can bypass these checks; use the canonical command.

`npm run package` includes `usage.json` as a separate release asset and in `SHA256SUMS`, never inside the install ZIP. The plugin runtime remains the three Obsidian assets. Existing 0.3.0 release assets are immutable and predate this documentation pipeline.

The GitHub Actions examples remain inactive because the current credential lacks workflow scope. If enabled later, the release example includes the same live-guide check; do not remove it. No production credential belongs in the plugin repository.
