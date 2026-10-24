# WalletWall canvas brand assets

Source files for the brand assets the WalletWall canvas embeds. `npm run gen:canvas-brand` encodes them into `plugin/com.github.copilot/extensions/walletwall-evidence-explorer/brand.mjs`; `npm run verify:canvas-brand` (part of `npm run verify`) fails if the plugin module or any file here no longer matches `brand-sources.json`.

| File | What | License or rights |
| --- | --- | --- |
| `walletwall-brick-wallet-96.png` | The WalletWall brick-wallet mark, downscaled | WalletWall brand asset; see `TRADEMARKS.md` |
| `walletwallaby-inspect.png`, `walletwallaby-perch.png` | WalletWallaby guide renders, cropped and downscaled | WalletWall brand asset; see `TRADEMARKS.md` |
| `fonts/*.woff2` | Sora, Manrope (variable) and IBM Plex Mono 400/500, latin subsets, unmodified | SIL Open Font License 1.1 (`fonts/OFL-*.txt`, reproduced in `plugin/THIRD_PARTY_NOTICES.md`) |

Where each file came from (repository, commit, path, original SHA-256) and exactly how it was transformed is recorded in `brand-sources.json`. Do not add an asset that is not taken from a WalletWall brand source, and do not redraw or recolour the mark. Design rules: `docs/CANVAS_DESIGN_SYSTEM.md`.
