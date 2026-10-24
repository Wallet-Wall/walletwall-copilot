// WalletWall canvas (internal id: walletwall-evidence-explorer): a read-only canvas that shows ONE WWEP evidence bundle exactly as the local WalletWall MCP
// server evaluated it. It adds no evidence, computes no state, writes nothing to disk and contacts no remote service.
//
// stdout is reserved for the extension JSON-RPC channel: never console.log from this process.
import { fileURLToPath } from "node:url";
import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { createExplorer, ExplorerInputError } from "./explorer.mjs";
import { FIXTURES } from "./fixtures.mjs";

// The same bundled, hash-pinned server file the plugin's mcp.json launches.
const serverPath = fileURLToPath(new URL("../../../server/walletwall-mcp.mjs", import.meta.url));
const explorer = createExplorer({ command: "node", serverArgs: [serverPath] });

const bundleInput = {
  type: "object",
  description: "Show a bundle. Provide `fixture`, or `bundle` together with `evaluatedAt`.",
  properties: {
    fixture: { type: "string", enum: Object.keys(FIXTURES), description: "A bundled synthetic evidence bundle." },
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
        "Inspect stablecoin identity, wallet state, source lineage, conflicts, and vault readiness through WalletWall MCP. Shows one evidence bundle: each assertion's support, authority class, freshness, finality, conflicts, limitations, dependencies, provenance and vault technical readiness, exactly as returned by the local WalletWall MCP tools.",
      inputSchema: bundleInput,
      actions: [
        {
          name: "set_bundle",
          description: "Replace the displayed bundle. Returns the evaluation the WalletWall MCP server produced for each assertion.",
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
          description: "Return what the panel currently shows: the WalletWall MCP results for the loaded bundle. Use this instead of re-deriving states.",
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
