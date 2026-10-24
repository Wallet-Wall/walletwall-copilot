/**
 * Drives the Evidence Explorer exactly as the Copilot app does (open, select, replace the bundle, close) while this process
 * runs under the privacy guard's canvas profile, and plays the part of the app's iframe over loopback HTTP.
 * It prints one JSON summary on stdout; the guard prints its own report on stderr at exit.
 * Test instrument only. Usage: node --import guard.ts canvas-driver.ts <guard-url> <mcp-entry> <canary-holder>
 */
import { get, request, type IncomingMessage } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const [guardUrl, entry, canary] = process.argv.slice(2) as [string, string, string];
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const EXT = `${ROOT}plugin/com.github.copilot/extensions/walletwall-evidence-explorer`;

interface Summary {
  status: string;
  selectedAssertionId?: string | null;
  assertions?: { id: string; evaluation: { supportState: string } | null }[];
}
interface Explorer {
  open: (id: string, input?: unknown) => Promise<{ url: string; title: string; status: string }>;
  setInput: (id: string, input: unknown) => Promise<Summary>;
  select: (id: string, assertionId: string) => Promise<Summary>;
  view: (id: string) => Summary;
  close: (id: string) => Promise<void>;
}
const explorerMod = (await import(pathToFileURL(`${EXT}/explorer.mjs`).href)) as {
  createExplorer: (o: { command: string; serverArgs: string[]; serverStderr: (s: string) => void }) => Explorer;
};
const fixturesMod = (await import(pathToFileURL(`${EXT}/fixtures.mjs`).href)) as { FIXTURES: Record<string, { bundle: unknown; evaluatedAt: string }> };

const childStderr: string[] = [];
const ex = explorerMod.createExplorer({ command: process.execPath, serverArgs: ["--import", guardUrl, entry], serverStderr: (s) => childStderr.push(s) });

interface Reply {
  status: number;
  headers: IncomingMessage["headers"];
  body: string;
}
function http(url: string, method: "GET" | "POST" = "GET", body?: string, headers: Record<string, string> = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers, agent: false }, (res) => {
      let text = "";
      res.on("data", (c: Buffer) => (text += c.toString("utf8")));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function firstSseEvent(url: string, trigger: () => Promise<unknown>): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = get(url, (res) => {
      let text = "";
      res.on("data", (c: Buffer) => {
        text += c.toString("utf8");
        if (text.includes("retry:") && !text.includes("data:")) void trigger();
        if (text.includes("data: update")) {
          resolve(text);
          req.destroy();
        }
      });
    });
    req.on("error", (e) => (/ECONNRESET|socket hang up/.test(String(e)) ? undefined : reject(e)));
  });
}

const opened = await ex.open("i1", { fixture: "usdc-established" });
const page = await http(opened.url);
const view1 = await http(`${opened.url}view`);
const select = await http(`${opened.url}select`, "POST", JSON.stringify({ assertionId: "a-balance" }), { "content-type": "application/json" });
const sse = await firstSseEvent(`${opened.url}events`, () => ex.select("i1", "a-identity"));

const fx = fixturesMod.FIXTURES["usdc-established"]!;
const withCanary = JSON.parse(JSON.stringify(fx.bundle).replaceAll("0x1234567890123456789012345678901234567890", canary)) as unknown;
const replaced = await ex.setInput("i1", { bundle: withCanary, evaluatedAt: fx.evaluatedAt });
const view2 = await http(`${opened.url}view`);
await ex.select("i1", "a-balance");
const view3 = await http(`${opened.url}view`);
const summary = ex.view("i1");

await ex.close("i1");
const afterClose = await http(opened.url).then(
  () => "ANSWERED",
  (e: NodeJS.ErrnoException) => e.code ?? "ERROR",
);

process.stdout.write(
  JSON.stringify({
    open: opened,
    page: { status: page.status, headers: page.headers, bytes: page.body.length },
    view1Status: view1.status,
    selectStatus: select.status,
    sseReceived: sse.includes("data: update"),
    replacedStatus: replaced.status,
    view2HasCanary: view2.body.includes(canary),
    view3HasCanary: view3.body.includes(canary),
    summaryHasCanary: JSON.stringify(summary).includes(canary),
    afterClose,
    childStderr: childStderr.join(""),
  }),
);
