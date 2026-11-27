# WallPrint public page: before and after (evidence only, never merges)

Screenshots for the draft pull request "design(wallprint): present the public resolver in the Living Record
language". This branch is an orphan that holds images only; it is never merged and shares no history with `main`.

- **Before:** the public resolver built from `main` at `0e372193e2e595815535ef28ab39482591c767f6`
  (`wallprint.d953856451e3931b.js`, `wallprint.33b61b0cfcfdeaa7.css`).
- **After:** the same build from the pull request head `53a7d3aad5b3d77d39ed3e6492fec79cc5734dc6`
  (`wallprint.d953856451e3931b.js`, byte-identical; `wallprint.5f58672cb080ea54.css`).
- **How:** `npm run build:wallprint-public` output served to headless Chromium (Playwright 1.61.1) by request
  interception at the resolver base, so the page sees its own origin and prints no mirror notice; every other request
  was refused. Desktop frames are 1440 px wide; phone frames use mobile emulation at 390, 375 and 320 px.
- **Data:** the committed synthetic publication store (`packages/wallprint-web/publication`), the engine-built fixture
  lineages. Nothing shown is a production record. The digest-mismatch, unreachable and not-compared states are
  produced the way `packages/wallprint-web/test/resolve.test.ts` produces them (another digest in the URL, a refused
  store request, a renamed artifact field).

| File | State | Width |
|---|---|---|
| `landing-1440.png`, `landing-375.png` | the bare route: the empty tool | 1440, 375 |
| `resolved-1440.png`, `resolved-375.png` | a resolved record, first screen | 1440, 375 |
| `record-head-1440.png` | the record's header and WalletWall's assessment as recorded | 1440 |
| `record-standing-1440.png` | the record's standing in the public store | 1440 |
| `record-verify-1440.png` | the four Verify questions | 1440 |
| `unavailable-1440.png`, `unavailable-375.png` | `UNAVAILABLE` | 1440, 375 |
| `mismatch-1440.png`, `mismatch-375.png` | `DIGEST_MISMATCH` (another digest in the URL) | 1440, 375 |
| `malformed-320.png` | `MALFORMED_REFERENCE` (an unknown section target) | 320 |
| `unreachable-network-390.png` | `UNREACHABLE` (the store request fails) | 390 |

Each picture is the before frame on the left and the after frame on the right, with the layout width and page
height the browser reported for each.
