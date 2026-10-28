# UCIT plugin maintenance

Author: Jason Shelter. GitHub owner: jasonshelter0.

For every user-visible change, update all three languages in `docs/usage.json`, keep its version aligned with `manifest.json`, and follow `docs/MAINTAINING.md`. The generated usage website must be synchronized and deployed before publishing a plugin release. Use `npm run release:publish`, which checks the live documentation fingerprint. Do not overwrite old release assets.

Never include a personal vault, `data.json`, private fixtures, credentials or local paths in public artifacts. Run `npm run check`, `npm test`, and `npm run docs:check`.
