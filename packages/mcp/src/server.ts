import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { RESOURCES, readResource } from "./resources.ts";
import { TOOLS, TOOL_ANNOTATIONS, callTool, inputJsonSchema } from "./tools.ts";
import { ENGINE_NAME, ENGINE_TITLE, ENGINE_VERSION } from "./version.ts";

const INSTRUCTIONS =
  "WalletWall evidence engine. Local, offline and read-only. It evaluates structured WWEP evidence you supply; it does not fetch chain data, hold keys, sign, or route transactions. Support states describe evidence sufficiency under published policy, not the truth of upstream data. Input shapes: walletwall://schemas/claims (per claim type) and walletwall://schemas/evidence (bundle); worked synthetic inputs: walletwall://examples/vault-readiness-established.";

/**
 * Tool and resource definitions are static. Nothing is loaded remotely and nothing is registered dynamically.
 * Input validation and error formatting are done here so that errors never echo caller-supplied values.
 */
export function createServer(): Server {
  const server = new Server(
    { name: ENGINE_NAME, title: ENGINE_TITLE, version: ENGINE_VERSION },
    { capabilities: { tools: {}, resources: {} }, instructions: INSTRUCTIONS },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: inputJsonSchema(t) as { type: "object"; [k: string]: unknown },
      annotations: { title: t.title, ...TOOL_ANNOTATIONS },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const outcome = callTool(request.params.name, request.params.arguments);
    if (outcome.ok) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify(outcome.result) }],
        structuredContent: outcome.result as Record<string, unknown>,
      };
    }
    return {
      isError: true,
      content: [{ type: "text" as const, text: JSON.stringify({ error: outcome.error }) }],
    };
  });

  server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: RESOURCES.map((r) => ({
      uri: r.uri,
      name: r.name,
      title: r.title,
      description: r.description,
      mimeType: r.mimeType,
    })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, (request) => {
    const r = readResource(request.params.uri);
    if (r === undefined) throw new Error("Unknown resource.");
    return { contents: [{ uri: r.uri, mimeType: r.mimeType, text: r.read() }] };
  });

  return server;
}
