import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { after, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { PUBLISHED_EXAMPLES } from "../../src/examples.ts";
import { DYNAMIC_CODE_FORMS, LITERAL_TRIPWIRE, bundleSections, dynamicCodeForms, withoutComments } from "../support/dynamic-code.ts";
import { ENTRIES, ROOT } from "../support/harness.ts";
import { createOwnedRun } from "../support/owned-temp.ts";

const PROBE = pathToFileURL(`${ROOT}packages/mcp/test/support/function-probe.ts`).href;
const ALIASED = "Function bound to a name";
const read = (path: string): string => readFileSync(`${ROOT}${path}`, "utf8");
const zodVersion = (JSON.parse(read("packages/mcp/package.json")) as { dependencies: Record<string, string> }).dependencies["zod"] as string;

// Every place in vendored Zod that reaches the Function constructor, each through `const F = Function`.
const ZOD_DYNAMIC_CODE_MODULES = ["v4/core/compile.js", "v4/core/doc.js", "v4/core/util.js"];

const CANARY_KEY = "canary-key-4f7a91";
const CANARY_VALUE = "canary-value-c03e58";

interface Exercise {
  transcript: string;
  bodies: string[] | undefined;
}

async function exercise(nodeArgs: string[], probeFile: string | undefined): Promise<Exercise> {
  const env: Record<string, string> = { PATH: process.env["PATH"] ?? "", SystemRoot: process.env["SystemRoot"] ?? "" };
  if (probeFile !== undefined) env["WW_FUNCTION_PROBE_FILE"] = probeFile;
  const transport = new StdioClientTransport({ command: process.execPath, args: [...nodeArgs, ENTRIES.bundle], env, stderr: "pipe" });
  let stderr = "";
  transport.stderr?.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
  const client = new Client({ name: "dynamic-code", version: "0" }, { capabilities: {} });
  await client.connect(transport);
  const transcript: Record<string, unknown> = {};
  try {
    transcript["tools"] = await client.listTools();
    const resources = await client.listResources();
    transcript["resources"] = resources;
    for (const r of resources.resources) transcript[r.uri] = await client.readResource({ uri: r.uri });
    for (const ex of PUBLISHED_EXAMPLES) transcript[ex.name] = await client.callTool(ex.toolCall);
    transcript["rejected"] = await client.callTool({ name: "inspect_evidence", arguments: { bundle: { [CANARY_KEY]: CANARY_VALUE }, evaluatedAt: "2026-10-23T12:00:30Z" } });
  } finally {
    await client.close();
  }
  assert.equal(stderr, "", "nothing may be written to stderr");
  let bodies: string[] | undefined;
  if (probeFile !== undefined) {
    for (let i = 0; i < 200 && !existsSync(probeFile); i++) await new Promise((r) => setTimeout(r, 25));
    bodies = JSON.parse(readFileSync(probeFile, "utf8")) as string[];
  }
  return { transcript: JSON.stringify(transcript), bodies };
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

describe("dynamic code generation: what is claimed and what is proved (PRIV-015)", () => {
  const runs: ReturnType<typeof createOwnedRun>[] = [];
  after(() => {
    for (const r of runs) r.dispose();
  });

  test("PRIV-015 the literal tripwire is exercised: it flags literal eval and Function-constructor text and is blind to an aliased constructor", () => {
    for (const flagged of ['eval("1")', 'new Function("return 1")', 'new  Function ("return 1")', 'Function("return 1")()']) {
      assert.ok(LITERAL_TRIPWIRE.test(flagged), `tripwire must flag: ${flagged}`);
    }
    const aliased = 'const F = Function;\nconst factory = new F("return 1");';
    assert.ok(!LITERAL_TRIPWIRE.test(aliased), "the tripwire does not see a Function constructor reached through another name");
    assert.deepEqual(dynamicCodeForms(aliased), [ALIASED], "the inventory does");
    assert.deepEqual(dynamicCodeForms('Reflect.construct(Function, ["return 1"])'), ["Reflect on Function"]);
    for (const clean of ["isAsyncFunction(fn)", 'const message = "Function types cannot be represented";', "const evaluation = 1;", "x instanceof Function"]) {
      assert.deepEqual(dynamicCodeForms(clean), [], clean);
      assert.ok(!LITERAL_TRIPWIRE.test(clean), clean);
    }
    // Declared limits: neither check sees these, and the documents do not claim they do.
    for (const invisible of ['(() => {}).constructor("return 1")', 'globalThis["Function"]("return 1")', "const g = globalThis; const F = g.Function;"]) {
      assert.deepEqual(dynamicCodeForms(invisible), [], invisible);
      assert.ok(!LITERAL_TRIPWIRE.test(invisible), invisible);
    }
    assert.ok(DYNAMIC_CODE_FORMS.length >= 4);
  });

  test("PRIV-015 shipped bundle: the tripwire finds nothing, yet exactly three vendored Zod modules reach the Function constructor and no other module does", () => {
    const bundle = readFileSync(ENTRIES.bundle, "utf8");
    assert.ok(!LITERAL_TRIPWIRE.test(bundle), "the tripwire is clean on the bundle");
    const sections = bundleSections(bundle);
    assert.ok(sections.size > 100 && sections.has("packages/mcp/src/server.ts"), "the bundle is split at its module markers");
    const found: Record<string, string[]> = {};
    for (const [section, code] of sections) {
      const forms = dynamicCodeForms(code);
      if (forms.length > 0) found[section] = forms;
    }
    assert.deepEqual(
      found,
      Object.fromEntries(ZOD_DYNAMIC_CODE_MODULES.map((m) => [`node_modules/zod/${m}`, [ALIASED]])),
      "dynamic-code inventory of the shipped bundle changed: review it, then update this list and the dynamic-code section of SECURITY.md",
    );
    for (const section of sections.keys()) {
      if (section.startsWith("packages/") || section.startsWith("walletwall-stub:")) assert.equal(found[section], undefined, `WalletWall-owned module ${section}`);
    }
  });

  test("PRIV-015 the Zod files the Claude Directory package copies (every .js file) carry the same inventory as the bundle", () => {
    const zodRoot = `${ROOT}node_modules/zod`;
    const found: string[] = [];
    for (const path of walk(zodRoot)) {
      if (!path.endsWith(".js")) continue;
      if (dynamicCodeForms(withoutComments(readFileSync(path, "utf8"))).length > 0) found.push(relative(zodRoot, path).replaceAll("\\", "/"));
    }
    assert.deepEqual(found.sort(), ZOD_DYNAMIC_CODE_MODULES, `vendored zod ${zodVersion} changed its dynamic-code inventory`);
  });

  test("PRIV-015 vendored Zod constructs functions at runtime, at startup and per call, from schema shape only; no caller-supplied value reaches the generated source", async () => {
    const run = createOwnedRun();
    runs.push(run);
    const startup = spawnSync(process.execPath, ["--import", PROBE, ENTRIES.bundle], { input: "", env: { PATH: process.env["PATH"] ?? "", SystemRoot: process.env["SystemRoot"] ?? "", WW_FUNCTION_PROBE_FILE: run.path("startup-probe.json") }, encoding: "utf8" });
    assert.equal(startup.status, 0);
    const atStartup = JSON.parse(readFileSync(run.path("startup-probe.json"), "utf8")) as string[];
    assert.ok(atStartup.includes("") && atStartup.some((b) => b !== ""), "the registry files are parsed at startup, before any request, and that builds functions");
    const { bodies } = await exercise(["--import", PROBE], run.path("function-probe.json"));
    assert.ok(bodies !== undefined && bodies.length > atStartup.length, "serving requests builds further functions: the claim that it builds none would be false");
    const probes = bodies.filter((b) => b === "");
    const generated = bodies.filter((b) => b !== "");
    assert.equal(probes.length, 1, "one capability probe, `new F(\"\")`, cached after its first use");
    assert.ok(generated.length > 0);
    for (const body of generated) assert.match(body, /^return function \(payload, ctx\) \{/, "only Zod's object-schema fast path builds code; its AOT compiler is never called");
    const callerValues = [CANARY_KEY, CANARY_VALUE, "a-identity", "a-balance", "2026-10-23T12:00:30Z", "0x1234567890123456789012345678901234567890"];
    for (const body of generated) for (const value of callerValues) assert.ok(!body.includes(value), `generated function source contains the caller-supplied value ${value}`);
  });

  test("PRIV-015 WalletWall does not depend on dynamic code generation: with it forbidden by V8 every response is identical", async () => {
    const control = spawnSync(process.execPath, ["--disallow-code-generation-from-strings", "-e", 'new Function("return 1")'], { encoding: "utf8" });
    assert.notEqual(control.status, 0, "positive control: the flag really blocks the Function constructor");
    assert.match(control.stderr, /EvalError/);

    const run = createOwnedRun();
    runs.push(run);
    const normal = await exercise([], undefined);
    const forbidden = await exercise(["--disallow-code-generation-from-strings"], undefined);
    const probed = await exercise(["--import", PROBE], run.path("equivalence-probe.json"));
    assert.equal(forbidden.transcript, normal.transcript);
    assert.equal(probed.transcript, normal.transcript, "the probe itself changes no response");
  });

  test("PRIV-015 the release documents and generator comments that describe the bundle make no unsupported dynamic-code claim", () => {
    const files = ["SECURITY.md", "PRIVACY.md", "docs/DEPENDENCY_POLICY.md", "docs/CLAUDE_DISTRIBUTION.md", "conformance/privacy/PRIV-matrix.json", "scripts/bundle-config.ts"];
    const stale = [/bundle contains no `new Function`/i, /contains no (?!literal)[^.|\n]*`new Function`/i, /or Function primitive/i, /removes dynamic code generation from the shipped artifact/i];
    for (const file of files) for (const re of stale) assert.ok(!re.test(read(file)), `${file} makes a claim the evidence does not support: ${re.source}`);
    const security = read("SECURITY.md");
    assert.ok(security.includes(`Zod ${zodVersion}`), "SECURITY.md names the Zod version the inventory was taken from");
    for (const m of ZOD_DYNAMIC_CODE_MODULES) assert.ok(security.includes(`zod/${m}`), `SECURITY.md lists zod/${m}`);
    assert.ok(security.includes("bounded tripwire"));
  });
});
