import { FINALITY_HINTS, FRESHNESS_HINTS, LIMITATION_LABELS, SUPPORT_HINTS } from "../../../plugin/com.github.copilot/extensions/walletwall-evidence-explorer/labels.mjs";
import { wallPrintClient } from "../../../plugin/com.github.copilot/extensions/walletwall-evidence-explorer/wallprint-client.mjs";
import { WALLPRINT_VOCABULARY } from "../../../plugin/com.github.copilot/extensions/walletwall-evidence-explorer/wallprint-fixtures.mjs";
import { renderReferenceOutcome, renderWallPrint } from "../../../plugin/com.github.copilot/extensions/walletwall-evidence-explorer/wallprint-render.mjs";
import { RESOLVER_ROUTE } from "../../mcp/src/wallprint/reference.ts";
import { resolvePublic, type PublicStore, type StoreResponse } from "../lib/resolve.ts";
import { publicView } from "../lib/view.ts";

/**
 * The public WallPrint resolver page. One static shell serves every URL under `/wallprint/`; this script reads the
 * page's own path and query, resolves them against the same-origin store (two fixed files under the route), and renders
 * the outcome with the canvas's WallPrint renderer in public mode. It talks to its own origin only, follows no redirect,
 * stores nothing, reads no clock, generates no identifier, and renders no record it did not prove.
 *
 *   WalletWall isn't always right. WallPrint keeps the record.
 */

const LABELS = { SUPPORT_HINTS, FRESHNESS_HINTS, FINALITY_HINTS, LIMITATION_LABELS };

const store: PublicStore = {
  async get(path: string): Promise<StoreResponse> {
    try {
      // Same-origin only, no credentials, no redirect: a store that answers with a redirect is an unreachable store.
      const response = await fetch(path, { method: "GET", mode: "same-origin", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", cache: "default" });
      return { status: response.status, text: response.status === 200 ? await response.text() : "" };
    } catch {
      return { status: 0, text: "" };
    }
  },
};

const TITLES: Record<string, string> = {
  RESOLVED: "WallPrint disclosure",
  UNAVAILABLE: "WallPrint: record unavailable",
  UNREACHABLE: "WallPrint: store unreachable",
  NOT_COMPARED: "WallPrint: not compared",
  DIGEST_MISMATCH: "WallPrint: digest mismatch",
  MALFORMED_REFERENCE: "WallPrint: malformed reference",
  UNSUPPORTED_VERSION: "WallPrint: unsupported version",
};

/** What the page says when resolving or rendering fails in a way it did not foresee: written as text, never as markup. */
const PAGE_FAILURE = "This page could not show a result for this address. Nothing is shown in its place.";

async function main(): Promise<void> {
  const app = document.getElementById("app");
  if (app === null) return;
  app.dataset["motion"] = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : "full";
  try {
    // The resolver base the share form uses is written into the shell by the build from the publication index; the view
    // module admits it only through the reference codec's own check, and compares it with the serving origin.
    const base = app.dataset["resolverBase"] ?? null;
    const resolution = await resolvePublic(`${location.pathname}${location.search}`, store);
    const landing = (location.pathname === RESOLVER_ROUTE || `${location.pathname}/` === RESOLVER_ROUTE) && location.search === "";
    const view = publicView(resolution, base, WALLPRINT_VOCABULARY, { servedFrom: location.origin, landing });
    // The one place markup enters the document: the renderer's output, every value of which it escaped itself.
    app.innerHTML = view.status === "wallprint" ? renderWallPrint(view, LABELS) : renderReferenceOutcome(view);
    document.title = landing ? "WallPrint public resolver" : (TITLES[resolution.outcome] ?? "WallPrint");
    wallPrintClient();
  } catch {
    app.textContent = PAGE_FAILURE;
    document.title = "WallPrint";
  }
}

void main();
