import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { GUARD, ENTRIES, ROOT, allFileBytes, hashesOf, listTree, newCanary, type GuardReport } from "../support/harness.ts";
import { createOwnedRun } from "../support/owned-temp.ts";

const EXT = `${ROOT}plugin/com.github.copilot/extensions/walletwall-evidence-explorer`;
const DRIVER = `${ROOT}packages/mcp/test/support/canvas-driver.ts`;
const read = (p: string): string => readFileSync(p, "utf8");
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const extFiles = readdirSync(EXT).map((n) => ({ name: n, code: strip(read(join(EXT, n))) }));
const runs: ReturnType<typeof createOwnedRun>[] = [];
after(() => {
  for (const r of runs) r.dispose();
});

const reportOf = (stderr: string): GuardReport => {
  const m = /WW_GUARD_REPORT (\{.*\})/.exec(stderr);
  assert.ok(m?.[1], "guard report missing");
  return JSON.parse(m[1]) as GuardReport;
};

describe("plugin path privacy: Copilot plugin + MCP + Canvas (PRIV-017, PRIV-018, PRIV-019)", () => {
  test("PRIV-019 the canvas extension imports no filesystem, OS, DNS, raw-socket, TLS, VM or worker module and calls no outbound network API", () => {
    const allowed: Record<string, string[]> = {
      "extension.mjs": ["node:url", "@github/copilot-sdk/extension", "./explorer.mjs", "./fixtures.mjs", "./wallprint-fixtures.mjs"],
      "explorer.mjs": ["node:crypto", "node:http", "./mcp-client.mjs", "./fixtures.mjs", "./wallprint-fixtures.mjs", "./wallprint-reference.mjs", "./render.mjs"],
      "mcp-client.mjs": ["node:child_process"],
      "render.mjs": ["./coinstellation-model.mjs", "./wall.mjs", "./brand.mjs", "./styles.mjs", "./client.mjs", "./wallprint-render.mjs", "./wallprint-styles.mjs", "./wallprint-client.mjs"],
      "client.mjs": ["./wall.mjs"],
      "wall.mjs": ["./coinstellation-model.mjs"],
      "coinstellation-model.mjs": [],
      "styles.mjs": [],
      "brand.mjs": [],
      "fixtures.mjs": [],
      // The WallPrint disclosure view: a pure renderer over serialized engine outputs, its stylesheet, its page script and the generated fixtures.
      "wallprint-render.mjs": ["./wall.mjs", "./wallprint-qr.mjs", "./wallprint-reference.mjs"],
      "wallprint-styles.mjs": [],
      "wallprint-client.mjs": [],
      "wallprint-fixtures.mjs": [],
      // The portable reference codec (generated from packages/mcp/src/wallprint/reference.ts) and the local QR encoder: both import nothing.
      "wallprint-reference.mjs": [],
      "wallprint-qr.mjs": [],
    };
    for (const f of extFiles.filter((x) => x.name.endsWith(".mjs"))) {
      assert.ok(Object.hasOwn(allowed, f.name), `${f.name} is a new canvas module: give it an explicit import allow-list here`);
      const specs = [...f.code.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)].map((m) => m[1] as string);
      assert.deepEqual([...specs].sort(), [...(allowed[f.name] ?? [])].sort(), `${f.name} imports`);
      // client.mjs holds the browser-side script; its fetch/EventSource targets are pinned by the PRIV-017 test below.
      if (f.name !== "client.mjs") assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource\s*\(|\.request\s*\(|https\.|http\.get|net\.connect|dgram|tls\./.test(f.code), `${f.name} calls a network client API`);
      assert.ok(!/\beval\s*\(|new\s+Function\b|\bimport\s*\(/.test(f.code), `${f.name} evaluates or dynamically imports code`);
      assert.ok(!/Date\.now|new Date\(|Math\.random|randomUUID|hostname|networkInterfaces|userInfo|machineId|fingerprint/i.test(f.code), `${f.name} reads the clock or machine identity or generates an identifier`);
      assert.ok(!/console\.|process\.stdout|process\.stderr/.test(f.code), `${f.name} writes to stdout/stderr (the extension channel) or the console`);
      assert.ok(!/(sentry|posthog|mixpanel|amplitude|appinsights|bugsnag|datadog|telemetry|analytics|crashpad)/i.test(f.code), `${f.name} mentions a telemetry product`);
    }
    assert.ok(/\.listen\(0, "127\.0\.0\.1"/.test(extFiles.find((f) => f.name === "explorer.mjs")?.code ?? ""), "the one listener is bound to loopback");
    assert.equal((extFiles.flatMap((f) => [...f.code.matchAll(/\.listen\(/g)]).length), 1, "exactly one listener");
  });

  test("PRIV-019 the only environment the canvas passes to the MCP child is PATH (and SystemRoot on Windows); nothing is read from the user's environment", () => {
    const client = extFiles.find((f) => f.name === "mcp-client.mjs")?.code ?? "";
    const reads = [...client.matchAll(/process\.env(?:\.([A-Za-z_]+)|\[["']([A-Za-z_]+)["']\])/g)].map((m) => m[1] ?? m[2]);
    assert.deepEqual([...new Set(reads)].sort(), ["PATH", "SystemRoot"]);
    for (const f of extFiles.filter((x) => x.name !== "mcp-client.mjs")) assert.ok(!/process\.env/.test(f.code), `${f.name} reads the environment`);
    assert.ok(/stdio: \["pipe", "pipe", onStderr \? "pipe" : "ignore"\]/.test(client));
  });

  test("PRIV-017 the canvas persists nothing in the browser and the page only talks to its own origin", () => {
    const client = extFiles.find((f) => f.name === "client.mjs")?.code ?? "";
    const browserSide = extFiles.filter((f) => ["client.mjs", "render.mjs", "styles.mjs", "wall.mjs", "wallprint-render.mjs", "wallprint-styles.mjs", "wallprint-client.mjs"].includes(f.name)).map((f) => f.code).join("\n");
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|caches\.|serviceWorker|navigator\.(?!clipboard\.writeText\()/.test(browserSide));
    const fetches = [...browserSide.matchAll(/fetch\(([^)]*)\)/g)].map((m) => m[1] as string);
    assert.ok(fetches.length >= 2);
    for (const a of fetches) assert.ok(/^base \+ "(view|select)"/.test(a.trim()), `client fetch target: ${a}`);
    assert.ok(/new EventSource\(base \+ "events"\)/.test(client));
    assert.equal((browserSide.match(/new EventSource\(/g) ?? []).length, 1);
  });

  test("PRIV-018 the canvas profile of the guard blocks and records what it must (positive control)", async () => {
    const run = createOwnedRun();
    runs.push(run);
    const cwd = run.mkdir("cwd");
    const script = [
      "const net=require('node:net'),http=require('node:http'),cp=require('node:child_process'),fs=require('node:fs'),dns=require('node:dns');",
      "const out={};",
      "const t=(k,f)=>{try{f();out[k]='ALLOWED'}catch(e){out[k]=String(e.message).startsWith('WW_GUARD_BLOCKED')?'BLOCKED':'ERROR:'+e.message}};",
      "t('listenAll',()=>http.createServer().listen(0,'0.0.0.0'));",
      "t('listenDefault',()=>net.createServer().listen(0));",
      "t('connectRemote',()=>net.connect({host:'93.184.216.34',port:80}));",
      "t('dns',()=>dns.lookup('example.com',()=>{}));",
      "t('spawnOther',()=>cp.spawn('cmd',['/c','echo']));",
      "t('writeFile',()=>fs.writeFileSync('x.txt','x'));",
      "t('https',()=>require('node:https').request('https://example.com'));",
      "let s;t('listenLoopback',()=>{s=http.createServer().listen(0,'127.0.0.1',()=>s.close())});",
      "process.stdout.write(JSON.stringify(out));",
    ].join("");
    const r = spawnSync(process.execPath, ["--import", GUARD, "-e", script], { cwd, encoding: "utf8", env: { PATH: process.env["PATH"] ?? "", SystemRoot: process.env["SystemRoot"] ?? "", WW_GUARD_PROFILE: "canvas" }, timeout: 30_000 });
    const out = JSON.parse(r.stdout) as Record<string, string>;
    assert.deepEqual(out, { listenAll: "BLOCKED", listenDefault: "BLOCKED", connectRemote: "BLOCKED", dns: "BLOCKED", spawnOther: "BLOCKED", writeFile: "BLOCKED", https: "BLOCKED", listenLoopback: "ALLOWED" });
    const rep = reportOf(r.stderr);
    assert.deepEqual(rep.canvas?.listen, ["127.0.0.1"]);
    assert.ok(rep.network.length >= 4 && rep.dns.length >= 1 && rep.spawn.length >= 1 && rep.fsWrite.length >= 1);
  });

  for (const [label, entry] of Object.entries(ENTRIES)) {
    test(`PRIV-018 entry ${label}: open, select, replace, close the canvas end to end: zero outbound network, zero DNS, zero writes, one loopback listener, MCP child clean`, async () => {
      const run = createOwnedRun();
      runs.push(run);
      const dirs = ["cwd", "home", "tmp", "appdata", "xdg-config", "xdg-cache", "xdg-data"].map((n) => run.mkdir(n));
      const [cwd, home, tmp, appdata, xdgConfig, xdgCache, xdgData] = dirs as [string, string, string, string, string, string, string];
      const canary = newCanary();
      const secrets = { GITHUB_TOKEN: "ghp_canvas_secret_canary_0001", WALLETWALL_API_KEY: "wwk_canvas_secret_canary_0002" };
      const r = spawnSync(process.execPath, ["--import", GUARD, DRIVER, GUARD, entry, canary], {
        cwd,
        encoding: "utf8",
        timeout: 120_000,
        env: { PATH: process.env["PATH"] ?? "", SystemRoot: process.env["SystemRoot"] ?? "", WW_GUARD_PROFILE: "canvas", HOME: home, USERPROFILE: home, TMP: tmp, TEMP: tmp, TMPDIR: tmp, APPDATA: appdata, LOCALAPPDATA: appdata, XDG_CONFIG_HOME: xdgConfig, XDG_CACHE_HOME: xdgCache, XDG_DATA_HOME: xdgData, ...secrets },
      });
      assert.equal(r.status, 0, `driver failed: ${r.stderr.slice(0, 600)}`);
      const summary = JSON.parse(r.stdout) as Record<string, unknown> & { page: { status: number; headers: Record<string, string> }; childStderr: string; open: { url: string } };

      // Behaviour: the app-facing surface really worked.
      assert.equal(summary.page.status, 200);
      assert.equal(summary["view1Status"], 200);
      assert.equal(summary["selectStatus"], 204);
      assert.equal(summary["sseReceived"], true);
      assert.equal(summary["replacedStatus"], "ready");
      assert.equal(summary["view3HasCanary"], true, "the panel displays the supplied address while it is open");
      assert.equal(summary["afterClose"], "ECONNREFUSED", "the listener is gone after close");
      assert.match(summary.open.url, /^http:\/\/127\.0\.0\.1:\d+\//);
      assert.equal(summary.page.headers["access-control-allow-origin"], undefined);

      // The Explorer process.
      const g = reportOf(r.stderr);
      assert.deepEqual(g.network, [], "no blocked network attempt");
      assert.deepEqual(g.dns, [], "no DNS lookup");
      assert.deepEqual(g.fsWrite, [], "no filesystem write");
      assert.deepEqual(g.spawn, [], "no spawn other than the bundled MCP server");
      assert.deepEqual(g.fingerprint, [], "no machine identity read");
      assert.ok(g.random.length >= 1 && g.random.every((x) => x === "crypto.randomBytes"), `random: ${JSON.stringify(g.random)}`);
      assert.deepEqual(g.canvas?.listen, ["127.0.0.1"], "exactly one listener, on loopback");
      assert.ok((g.canvas?.loopbackConnect.length ?? 0) >= 1 && g.canvas?.loopbackConnect.every((h) => h === "127.0.0.1"));
      assert.ok((g.canvas?.spawnAllowed.length ?? 0) >= 4 && g.canvas?.spawnAllowed.every((n) => n === (label === "bundle" ? "walletwall-mcp.mjs" : "main.ts")), JSON.stringify(g.canvas?.spawnAllowed));

      // Every MCP server the canvas started ran under the strict guard.
      const childReports = [...summary.childStderr.matchAll(/WW_GUARD_REPORT (\{.*\})/g)].map((m) => JSON.parse(m[1] as string) as GuardReport);
      assert.equal(childReports.length, g.canvas?.spawnAllowed.length, "one clean report per MCP server start");
      for (const c of childReports) for (const k of ["network", "dns", "fsWrite", "spawn", "random", "fingerprint"] as const) assert.deepEqual(c[k], [], `MCP child ${k}`);

      // Nothing persisted anywhere WalletWall code could have written.
      assert.deepEqual(dirs.flatMap(listTree), [], "no file in cwd, HOME, TMP, APPDATA or XDG directories");
      const bytes = allFileBytes(dirs);
      const hay = [r.stderr, summary.childStderr, ...bytes.map((b) => b.toString("latin1"))].join("\n").toLowerCase();
      assert.ok(!hay.includes(canary.toLowerCase()), "the wallet address must not appear in files or diagnostics");
      for (const h of hashesOf(canary)) assert.ok(!hay.includes(h.toLowerCase()), "no hash of the wallet address");
      for (const s of Object.values(secrets)) assert.ok(!hay.includes(s.toLowerCase()) && !r.stdout.includes(s), "credentials in the environment are neither written nor shown");
    });
  }

  test("PRIV-017 plugin files carry no WalletWall endpoint, user ID, device ID, analytics or crash-report integration", () => {
    const all = [...extFiles, { name: "plugin.json", code: read(`${ROOT}plugin/plugin.json`) }, { name: "mcp.json", code: read(`${ROOT}plugin/mcp.json`) }, { name: "SKILL.md", code: read(`${ROOT}plugin/skills/walletwall-evidence/SKILL.md`) }];
    for (const f of all) {
      assert.ok(!/walletwall\.(com|io|xyz|app|dev|org)|vercel\.app|googleapis\.com|run\.app|upstash|api\.walletwall/i.test(f.code), `${f.name} names a WalletWall-operated endpoint`);
      assert.ok(!/(user[_-]?id|device[_-]?id|anonymous[_-]?id|install[_-]?id|session[_-]?id|machine[_-]?id|distinct[_-]?id|trackEvent|track\()/i.test(f.code.replace(/instanceId|session\.sessionId/g, "")), `${f.name} refers to an identifier or tracking call`);
    }
  });
});
