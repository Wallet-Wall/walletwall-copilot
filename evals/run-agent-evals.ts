/**
 * Agent-eval harness: runs the cases in evals/cases.json against a REAL GitHub Copilot CLI session that has the WalletWall
 * plugin installed from this checkout, and grades what the model did and said.
 *
 * This is NOT part of CI or of the MCP conformance suites. It needs a signed-in Copilot (a token in GH_TOKEN,
 * COPILOT_GITHUB_TOKEN or GITHUB_TOKEN, or `gh auth token`), network access to GitHub's model service, and it produces
 * non-deterministic prose. Graders are heuristics; the recorded run also carries a manual verdict (see docs/AGENT_EVALS.md).
 *
 * Usage: node evals/run-agent-evals.ts [--cli <copilot>] [--only AE-01,AE-02] [--concurrency 3] [--model <id>] [--out <file>]
 * The Copilot CLI runs with an isolated COPILOT_HOME created under the owned temp root and removed afterwards, so the
 * user's real Copilot configuration is neither read nor changed.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createOwnedRun } from "../packages/mcp/test/support/owned-temp.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

interface Case {
  id: string;
  risk: string;
  title: string;
  prompt: string;
  bundle?: { case?: string; fixture?: string };
  expect: { toolsAnyOf: string[]; mustMention: string[][]; mustNotMatch: string[] };
}
const corpus = JSON.parse(readFileSync(`${root}evals/cases.json`, "utf8")) as { version: string; cases: Case[] };
const only = opt("only")?.split(",");
const cases = corpus.cases.filter((c) => only === undefined || only.includes(c.id));
const cli = opt("cli") ?? process.env["WALLETWALL_EVAL_COPILOT_CLI"] ?? "copilot";
const concurrency = Number(opt("concurrency") ?? "3");
const model = opt("model");

function token(): string {
  for (const k of ["GH_TOKEN", "COPILOT_GITHUB_TOKEN", "GITHUB_TOKEN"]) if (process.env[k]) return process.env[k];
  const r = spawnSync("gh", ["auth", "token"], { encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  throw new Error("No Copilot-capable GitHub token found (GH_TOKEN, COPILOT_GITHUB_TOKEN, GITHUB_TOKEN or `gh auth token`).");
}

async function bundleFor(c: Case): Promise<{ bundle: string; evaluatedAt: string } | undefined> {
  if (c.bundle === undefined) return undefined;
  if (c.bundle.case !== undefined) {
    const found = ["evidence", "authority", "freshness", "conflict", "adversarial"].map((d) => `${root}conformance/${d}/${c.bundle?.case}.json`).find((p) => {
      try {
        readFileSync(p);
        return true;
      } catch {
        return false;
      }
    });
    if (found === undefined) throw new Error(`conformance case ${c.bundle.case} not found`);
    const j = JSON.parse(readFileSync(found, "utf8")) as { bundle: unknown; evaluatedAt: string };
    return { bundle: JSON.stringify(j.bundle), evaluatedAt: j.evaluatedAt };
  }
  const fixtures = (await import(`${root.startsWith("/") ? "file://" : "file:///"}${root}plugin/com.github.copilot/extensions/walletwall-evidence-explorer/fixtures.mjs`)) as { FIXTURES: Record<string, { bundle: unknown; evaluatedAt: string }> };
  const fx = fixtures.FIXTURES[c.bundle.fixture ?? ""];
  if (fx === undefined) throw new Error(`fixture ${c.bundle.fixture} not found`);
  return { bundle: JSON.stringify(fx.bundle), evaluatedAt: fx.evaluatedAt };
}

interface Run {
  tools: { name: string; mcpServer: string | null; mcpTool: string | null; success: boolean | null }[];
  finalText: string;
  exitCode: number | null;
  seconds: number;
  error?: string;
}

function copilot(home: string, cwd: string, argv: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cli, argv, { cwd, env: { ...process.env, COPILOT_HOME: home, GH_TOKEN: token() }, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" && !cli.includes("\\") && !cli.includes("/") });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function parse(stdout: string): Pick<Run, "tools" | "finalText"> {
  const tools: Run["tools"] = [];
  const done = new Map<string, boolean>();
  const texts: string[] = [];
  const starts: { id: string; i: number }[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith("{")) continue;
    let e: { type?: string; data?: Record<string, unknown> };
    try {
      e = JSON.parse(line) as typeof e;
    } catch {
      continue;
    }
    const d = e.data ?? {};
    if (e.type === "tool.execution_start") {
      tools.push({ name: str(d["toolName"]), mcpServer: (d["mcpServerName"] as string | undefined) ?? null, mcpTool: (d["mcpToolName"] as string | undefined) ?? null, success: null });
      starts.push({ id: str(d["toolCallId"]), i: tools.length - 1 });
    } else if (e.type === "tool.execution_complete") done.set(str(d["toolCallId"]), d["success"] === true);
    else if (e.type === "assistant.message" && typeof d["content"] === "string" && d["content"].trim() !== "") texts.push(d["content"]);
  }
  for (const s of starts) if (done.has(s.id)) (tools[s.i] as Run["tools"][number]).success = done.get(s.id) as boolean;
  return { tools, finalText: texts.at(-1) ?? "" };
}

interface Grade {
  toolSelection: "PASS" | "FAIL" | "N/A";
  limitationsAndStatesMentioned: "PASS" | "FAIL";
  noForbiddenClaim: "PASS" | "FAIL";
  details: string[];
  automated: "PASS" | "FAIL";
}
function grade(c: Case, r: Run): Grade {
  const details: string[] = [];
  const called = new Set(r.tools.filter((t) => t.mcpServer === "walletwall").map((t) => t.mcpTool ?? t.name.replace(/^walletwall-/, "")));
  let toolSelection: Grade["toolSelection"] = "N/A";
  if (c.expect.toolsAnyOf.length > 0) {
    toolSelection = c.expect.toolsAnyOf.some((t) => called.has(t)) ? "PASS" : "FAIL";
    if (toolSelection === "FAIL") details.push(`expected one of ${c.expect.toolsAnyOf.join(", ")}; called ${[...called].join(", ") || "none"}`);
  }
  let mention: Grade["limitationsAndStatesMentioned"] = "PASS";
  for (const group of c.expect.mustMention) {
    if (!group.some((p) => new RegExp(p, "i").test(r.finalText))) {
      mention = "FAIL";
      details.push(`none of [${group.join(" | ")}] found in the answer`);
    }
  }
  let forbidden: Grade["noForbiddenClaim"] = "PASS";
  for (const p of c.expect.mustNotMatch) {
    const m = new RegExp(p, "im").exec(r.finalText);
    if (m) {
      forbidden = "FAIL";
      details.push(`forbidden pattern /${p}/ matched: "${m[0].slice(0, 80)}"`);
    }
  }
  const automated = toolSelection !== "FAIL" && mention === "PASS" && forbidden === "PASS" && r.finalText !== "" ? "PASS" : "FAIL";
  if (r.finalText === "") details.push("no final answer was produced");
  return { toolSelection, limitationsAndStatesMentioned: mention, noForbiddenClaim: forbidden, details, automated };
}

async function main(): Promise<void> {
  const run = createOwnedRun();
  const home = run.mkdir("copilot-home");
  const cwd = run.mkdir("cwd");
  try {
    const version = (await copilot(home, cwd, ["--version"], 60_000)).stdout.trim().split(/\r?\n/)[0] ?? "";
    const marketplace = (JSON.parse(readFileSync(`${root}.github/plugin/marketplace.json`, "utf8")) as { name: string }).name;
    for (const setup of [["plugin", "marketplace", "add", root], ["plugin", "install", `walletwall@${marketplace}`]]) {
      const r = await copilot(home, cwd, setup, 120_000);
      if (r.code !== 0) throw new Error(`setup failed: copilot ${setup.join(" ")}: ${r.stdout}${r.stderr}`);
    }
    const listing = JSON.parse((await copilot(home, cwd, ["plugin", "list", "--json"], 60_000)).stdout) as { name: string; version?: string; enabled: boolean }[];
    const listed = listing.find((p) => p.name === "walletwall");
    if (!listed?.enabled) throw new Error("the walletwall plugin is not enabled in the isolated Copilot home");
    // The plugin listing names the local checkout directory. A recorded result is public, so keep only non-identifying fields.
    const plugin = { ...listed, installedFrom: "<local checkout>" };

    const results: unknown[] = [];
    const queue = [...cases];
    const worker = async (): Promise<void> => {
      for (let c = queue.shift(); c !== undefined; c = queue.shift()) {
        const b = await bundleFor(c);
        const prompt = c.prompt.replaceAll("{{bundle}}", b?.bundle ?? "").replaceAll("{{evaluatedAt}}", b?.evaluatedAt ?? "");
        const t0 = Date.now();
        const argv = ["-p", prompt, "--output-format", "json", "--allow-tool=walletwall", "--deny-tool=shell", "--deny-tool=write", "--disable-builtin-mcps", "--no-ask-user", "--log-level", "none", ...(model ? ["--model", model] : [])];
        const out = await copilot(home, cwd, argv, 240_000);
        const parsed = parse(out.stdout);
        const r: Run = { ...parsed, exitCode: out.code, seconds: Math.round((Date.now() - t0) / 100) / 10 };
        if (out.code !== 0) r.error = out.stderr.slice(0, 400);
        results.push({ id: c.id, risk: c.risk, title: c.title, prompt: prompt.length > 600 ? `${prompt.slice(0, 600)}... [${prompt.length} chars]` : prompt, run: r, grade: grade(c, r), manualVerdict: null });
        console.log(`${c.id} ${grade(c, r).automated} (${r.seconds}s) tools: ${r.tools.map((t) => t.mcpTool ?? t.name).join(", ") || "none"}`);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
    results.sort((a, b) => String((a as { id: string }).id).localeCompare(String((b as { id: string }).id)));

    const out = opt("out") ?? `${root}evals/results/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    mkdirSync(out.slice(0, Math.max(out.lastIndexOf("/"), out.lastIndexOf("\\"))), { recursive: true });
    writeFileSync(out, `${JSON.stringify({ corpusVersion: corpus.version, copilotCli: version, platform: process.platform, node: process.version, model: model ?? "default", plugin, note: "Automated grades are heuristics. manualVerdict is filled in by a human reviewer.", results }, null, 2)}\n`);
    console.log(`wrote ${out}`);
  } finally {
    run.dispose();
  }
}

await main();
