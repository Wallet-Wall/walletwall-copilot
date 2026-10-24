import type { BuildOptions, Plugin } from "esbuild";

/**
 * The SDK's default JSON Schema validator pulls Ajv (which compiles schemas with `new Function`) into the bundle. The
 * server never asks the SDK to validate a schema (it advertises no elicitation and validates tool input itself), so the
 * module is replaced with a stub that refuses to run. This removes dynamic code generation from the shipped artifact.
 */
const AJV_STUB = `export class AjvJsonSchemaValidator {
  getValidator() {
    throw new Error("SDK JSON Schema validation is disabled in the WalletWall bundle.");
  }
}
`;

export const stubSdkAjv: Plugin = {
  name: "stub-sdk-ajv-validator",
  setup(build) {
    build.onResolve({ filter: /validation\/ajv-provider\.js$/ }, (args) =>
      /@modelcontextprotocol[\\/]sdk/.test(args.importer) ? { path: "ajv-provider-stub", namespace: "walletwall-stub" } : undefined,
    );
    build.onLoad({ filter: /.*/, namespace: "walletwall-stub" }, () => ({ contents: AJV_STUB, loader: "js" }));
  },
};

export function bundleOptions(root: string): BuildOptions & { write: false; metafile: true } {
  return {
    absWorkingDir: root,
    entryPoints: ["packages/mcp/src/main.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    write: false,
    metafile: true,
    legalComments: "none",
    logLevel: "warning",
    plugins: [stubSdkAjv],
  };
}

/**
 * The only MCP SDK modules that may be part of the shipped bundle: the low-level server, the stdio transport and the
 * protocol machinery they share. No HTTP, SSE, Streamable HTTP, client, auth, express or middleware module belongs here.
 */
export const ALLOWED_SDK_MODULES: readonly string[] = [
  "experimental/tasks/helpers.js",
  "experimental/tasks/interfaces.js",
  "experimental/tasks/server.js",
  "server/index.js",
  "server/stdio.js",
  "server/zod-compat.js",
  "server/zod-json-schema-compat.js",
  "shared/protocol.js",
  "shared/stdio.js",
  "types.js",
];
