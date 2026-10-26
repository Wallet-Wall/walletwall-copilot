// WalletWall canvas (internal id: walletwall-evidence-explorer): a read-only canvas that shows ONE WWEP evidence bundle exactly as the local WalletWall MCP
// server evaluated it. It adds no evidence, computes no state, writes nothing to disk and contacts no remote service.
//
// stdout is reserved for the extension JSON-RPC channel: never console.log from this process.
import { fileURLToPath } from "node:url";
import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { createExplorer, ExplorerInputError } from "./explorer.mjs";
import { FIXTURES } from "./fixtures.mjs";
import { WALLPRINT_FIXTURES } from "./wallprint-fixtures.mjs";

// The same bundled, hash-pinned server file the plugin's mcp.json launches.
const serverPath = fileURLToPath(new URL("../../../server/walletwall-mcp.mjs", import.meta.url));
const explorer = createExplorer({ command: "node", serverArgs: [serverPath] });

const bundleInput = {
  type: "object",
  description: "Show a bundle, or a WallPrint disclosure record. Provide `fixture`, or `bundle` together with `evaluatedAt`, or `wallprint` alone, or `reference` alone.",
  properties: {
    fixture: { type: "string", enum: Object.keys(FIXTURES), description: "A bundled synthetic evidence bundle." },
    wallprint: { type: "string", enum: Object.keys(WALLPRINT_FIXTURES), description: "A bundled synthetic WallPrint disclosure lineage, shown as a disclosure record exactly as the WallPrint engine produced it." },
    reference: { type: "string", description: "A portable WallPrint reference exactly as scanned or copied (walletwall://wallprint/... or its JSON envelope). It is parsed strictly and resolved only against the bundled disclosure lineages; the panel reports RESOLVED, UNAVAILABLE (the record is not held here), DIGEST_MISMATCH, MALFORMED_REFERENCE or UNSUPPORTED_VERSION. A reference locates a record; it establishes nothing about the record's claims." },
    bundle: { type: "object", description: "A WWEP 0.1 evidence bundle, exactly as you pass it to the WalletWall MCP tools. Do not pass tool output here." },
    evaluatedAt: { type: "string", description: "Evaluation time, UTC ISO 8601 with a Z suffix, exactly as passed to the WalletWall MCP tools." },
    assertionId: { type: "string", description: "Assertion to show first." },
  },
  additionalProperties: false,
};

const guard = async (fn) => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ExplorerInputError) throw new CanvasError("input_invalid", e.message);
    throw e;
  }
};

await joinSession({
  canvases: [
    createCanvas({
      id: "walletwall-evidence-explorer",
      displayName: "WalletWall",
      description:
        "Inspect stablecoin identity, wallet state, source lineage, conflicts, and vault readiness through WalletWall MCP. Shows one evidence bundle: each assertion's support, authority class, freshness, finality, conflicts, limitations, dependencies, provenance and vault technical readiness, exactly as returned by the local WalletWall MCP tools. Can also show a fixture-backed WallPrint disclosure record: the canonical record, its lifecycle, assessments, provenance, corrections and verification data, exactly as the WallPrint engine recorded them.",
      inputSchema: bundleInput,
      actions: [
        {
          name: "set_bundle",
          description: "Replace the displayed bundle, show a WallPrint disclosure record (`wallprint`), or open a portable WallPrint reference (`reference`). Returns the evaluation the WalletWall MCP server produced for each assertion, or the disclosure's recorded lifecycle, assessments, receipt and replay results, or the reference's resolution outcome.",
          inputSchema: bundleInput,
          handler: (ctx) => guard(() => explorer.setInput(ctx.instanceId, ctx.input ?? {})),
        },
        {
          name: "select_assertion",
          description: "Show one assertion of the loaded bundle, with its provenance.",
          inputSchema: { type: "object", properties: { assertionId: { type: "string" } }, required: ["assertionId"], additionalProperties: false },
          handler: (ctx) => guard(() => explorer.select(ctx.instanceId, ctx.input?.assertionId)),
        },
        {
          name: "get_view",
          description: "Return what the panel currently shows: the WalletWall MCP results for the loaded bundle, or the WallPrint disclosure's recorded results. Use this instead of re-deriving states.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          handler: (ctx) => guard(() => explorer.view(ctx.instanceId)),
        },
      ],
      open: async (ctx) => {
        const opened = await explorer.open(ctx.instanceId, ctx.input);
        return { url: opened.url, title: opened.title, status: opened.status };
      },
      onClose: async (ctx) => {
        await explorer.close(ctx.instanceId);
      },
    }),
  ],
});
