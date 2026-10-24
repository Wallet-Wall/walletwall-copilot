import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { EVALUATED_AT, HOLDER, USDC, golden } from "./builders.ts";
import { createOwnedRun } from "./owned-temp.ts";

export const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
export const ENTRIES = {
  source: `${ROOT}packages/mcp/src/main.ts`,
  bundle: `${ROOT}plugin/server/walletwall-mcp.mjs`,
} as const;
export const GUARD = pathToFileURL(`${ROOT}packages/mcp/test/support/guard.ts`).href;

export interface GuardReport {
  network: string[];
  dns: string[];
  fsWrite: string[];
  spawn: string[];
  random: string[];
  fingerprint: string[];
  /** Present only for the canvas profile. */
  canvas?: { listen: string[]; loopbackConnect: string[]; spawnAllowed: string[] };
}

export interface Session {
  canary: string;
  secrets: Record<string, string>;
  dirs: string[];
  tree: string[];
  stderr: string;
  guard: GuardReport;
  responses: string[];
  cleanup: () => void;
}

export function listTree(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      out.push(p);
      if (statSync(p).isDirectory()) walk(p);
    }
  };
  walk(dir);
  return out;
}

export function allFileBytes(dirs: string[]): Buffer[] {
  const out: Buffer[] = [];
  for (const d of dirs) {
    for (const p of listTree(d)) if (statSync(p).isFile()) out.push(readFileSync(p));
  }
  return out;
}

export function newCanary(): string {
  return `0x${randomBytes(20).toString("hex")}`;
}

export function hashesOf(value: string): string[] {
  const lower = value.toLowerCase();
  const bare = lower.replace(/^0x/, "");
  const out: string[] = [];
  for (const v of [value, lower, bare]) {
    for (const alg of ["sha256", "sha1", "md5", "sha512"]) {
      const h = createHash(alg).update(v, "utf8").digest();
      out.push(h.toString("hex"), h.toString("base64"));
    }
    const raw = Buffer.from(bare, "hex");
    out.push(createHash("sha256").update(raw).digest("hex"));
  }
  return out;
}

export interface RawResult {
  code: number | null;
  stdout: string;
  stderr: string;
  guard: GuardReport;
  tree: string[];
  cleanup: () => void;
}

/** Sends raw lines to the server over stdio (no SDK client), then closes stdin, and reports how it ended. */
export async function runRaw(entry: string, lines: string[]): Promise<RawResult> {
  const run = createOwnedRun();
  const dirs = ["cwd", "home", "tmp"].map((n) => run.mkdir(n));
  const [cwd, home, tmp] = dirs as [string, string, string];
  const child = spawn(process.execPath, ["--import", GUARD, entry], {
    cwd,
    env: { PATH: process.env["PATH"] ?? "", SystemRoot: process.env["SystemRoot"] ?? "", HOME: home, USERPROFILE: home, TMP: tmp, TEMP: tmp, TMPDIR: tmp },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
  child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
  const exited = new Promise<number | null>((resolve) => child.on("close", (c) => resolve(c)));
  for (const l of lines) child.stdin.write(`${l}\n`);
  child.stdin.end();
  const code = await Promise.race([exited, new Promise<number | null>((r) => setTimeout(() => r(-999), 15_000))]);
  if (code === -999) child.kill();
  const m = /WW_GUARD_REPORT (\{.*\})/.exec(stderr);
  const guard: GuardReport = m?.[1] ? (JSON.parse(m[1]) as GuardReport) : { network: ["MISSING_REPORT"], dns: [], fsWrite: [], spawn: [], random: [], fingerprint: [] };
  return { code, stdout, stderr, guard, tree: dirs.flatMap(listTree), cleanup: () => run.dispose() };
}

export interface RunOptions {
  entry: string;
  withGuard?: boolean;
  extraEnv?: Record<string, string>;
  garbage?: boolean;
  canary?: string;
}

/**
 * Runs the real MCP server over stdio in an isolated environment (fresh cwd, HOME, TMP and XDG directories),
 * exercises every tool and resource with a unique canary wallet address, then returns what was observed.
 */
export async function runSession(opts: RunOptions): Promise<Session> {
  const run = createOwnedRun();
  const dirs = ["cwd", "home", "tmp", "appdata", "xdg-config", "xdg-cache", "xdg-data"].map((n) => run.mkdir(n));
  const [cwd, home, tmp, appdata, xdgConfig, xdgCache, xdgData] = dirs as [string, string, string, string, string, string, string];
  const canary = opts.canary ?? newCanary();
  const secrets = {
    GITHUB_TOKEN: `ghp_${randomBytes(18).toString("hex")}`,
    WALLETWALL_API_KEY: `wwk_${randomBytes(18).toString("hex")}`,
    ALCHEMY_API_KEY: `alc_${randomBytes(18).toString("hex")}`,
  };
  const env: Record<string, string> = {
    HOME: home,
    USERPROFILE: home,
    TMPDIR: tmp,
    TMP: tmp,
    TEMP: tmp,
    APPDATA: appdata,
    LOCALAPPDATA: appdata,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_CACHE_HOME: xdgCache,
    XDG_DATA_HOME: xdgData,
    ...secrets,
    ...(opts.extraEnv ?? {}),
  };

  const args = opts.withGuard === false ? [opts.entry] : ["--import", GUARD, opts.entry];
  const transport = new StdioClientTransport({ command: process.execPath, args, env, cwd, stderr: "pipe" });
  let stderr = "";
  transport.stderr?.on("data", (d: Buffer) => {
    stderr += d.toString("utf8");
  });
  const client = new Client({ name: "privacy-test", version: "0" });
  await client.connect(transport);

  const responses: string[] = [];
  const keep = (r: unknown): void => {
    responses.push(JSON.stringify(r));
  };
  const withCanary = JSON.parse(JSON.stringify(golden()).replaceAll(HOLDER, canary)) as ReturnType<typeof golden>;
  keep(await client.listTools());
  keep(await client.listResources());
  keep(await client.callTool({ name: "resolve_asset", arguments: { chainId: "1", address: canary } }));
  keep(await client.callTool({ name: "resolve_asset", arguments: { chainId: "1", address: USDC } }));
  keep(
    await client.callTool({
      name: "normalize_observation",
      arguments: {
        id: "obs-1",
        sourceId: "src-chain",
        origin: "CHAIN_OBSERVED",
        observedAt: EVALUATED_AT,
        finality: "FINALIZED",
        result: "VALUE",
        chainId: "1",
        token: USDC,
        holder: canary,
        blockNumber: "21000000",
        blockHash: `0x${"ab".repeat(32)}`,
        balanceAtomic: "1500000",
        decimals: "6",
      },
    }),
  );
  keep(await client.callTool({ name: "inspect_evidence", arguments: { bundle: withCanary, evaluatedAt: EVALUATED_AT } }));
  keep(await client.callTool({ name: "check_invariants", arguments: { bundle: withCanary, evaluatedAt: EVALUATED_AT } }));
  keep(await client.callTool({ name: "trace_provenance", arguments: { bundle: withCanary, assertionId: "a-balance" } }));
  keep(
    await client.callTool({
      name: "assess_vault_readiness",
      arguments: { bundle: withCanary, evaluatedAt: EVALUATED_AT, identityAssertionId: "a-identity", balanceAssertionId: "a-balance" },
    }),
  );
  keep(await client.callTool({ name: "resolve_asset", arguments: { chainId: "1", address: canary, extra: canary } }));
  for (const r of (await client.listResources()).resources) keep(await client.readResource({ uri: r.uri }));

  await client.close();
  await new Promise((r) => setTimeout(r, 200));

  const m = /WW_GUARD_REPORT (\{.*\})/.exec(stderr);
  const guard: GuardReport = m?.[1]
    ? (JSON.parse(m[1]) as GuardReport)
    : { network: [], dns: [], fsWrite: [], spawn: [], random: [], fingerprint: [] };
  if (opts.withGuard !== false && m === null) throw new Error("guard report missing; the guard did not run or the server did not exit cleanly");

  return {
    canary,
    secrets,
    dirs,
    tree: dirs.flatMap(listTree),
    stderr,
    guard,
    responses,
    cleanup: () => run.dispose(),
  };
}
