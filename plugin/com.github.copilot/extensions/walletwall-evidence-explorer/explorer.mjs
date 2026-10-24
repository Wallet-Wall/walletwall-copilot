// WalletWall canvas (internal id: walletwall-evidence-explorer): per-instance state and a loopback-only HTTP server that serves the page to the Copilot
// app's canvas iframe.
//
// Privacy posture (tested in packages/mcp/test/privacy/plugin-path.test.ts):
//  - The only listener is bound to 127.0.0.1 on an OS-chosen port, protected by an unguessable path token and a Host check.
//  - The page is served with a Content-Security-Policy that lets it talk to nothing but its own origin.
//  - The loaded bundle lives in process memory for the life of the canvas instance and is dropped on close.
//    Nothing is written to disk, nothing is sent anywhere, no identifier is generated for the user or the device.
//  - The only random value is the per-instance URL token / CSP nonce, which exists to stop other local web pages from
//    reading the panel. It is never persisted or transmitted.
//
// The WalletWall Canvas visualizes an authoritative MCP-evaluated view. Fixtures provide input, `explorer.mjs` owns Canvas
// state, and Coinstellation is a deterministic presentation projection. No renderer, layout, interaction, motion, or
// browser-time calculation may create, strengthen, or replace WalletWall evidence state. Here: normalizeInput() validates
// and copies the input and evaluates nothing; the WalletWall MCP server evaluates; buildView() joins the bundle with the
// MCP results into the authoritative Canvas view (empty, error or ready), which render.mjs projects into the page.
// view.selectedId is the one assertion selection, shared by the person (POST select) and the agent (select_assertion).
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { callTools } from "./mcp-client.mjs";
import { FIXTURES } from "./fixtures.mjs";
import { renderPage, renderView } from "./render.mjs";

export class ExplorerInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExplorerInputError";
  }
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const deepFreeze = (v) => {
  if (v !== null && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
};
const PREFERRED_DEFAULT = ["ASSET_IDENTITY"];

/** Chooses what to show first. This is a layout decision only; it does not rank evidence. */
function defaultSelection(bundle) {
  const assertions = Array.isArray(bundle.assertions) ? bundle.assertions : [];
  for (const type of PREFERRED_DEFAULT) {
    const hit = assertions.find((a) => isObject(a) && a.claimType === type);
    if (hit) return hit.id;
  }
  return assertions.find(isObject)?.id ?? null;
}

export function normalizeInput(input) {
  if (!isObject(input)) throw new ExplorerInputError("Provide either `fixture`, or `bundle` with `evaluatedAt`.");
  for (const k of Object.keys(input)) if (!["fixture", "bundle", "evaluatedAt", "assertionId"].includes(k)) throw new ExplorerInputError(`Unknown input field: ${k}`);
  if (input.assertionId !== undefined && typeof input.assertionId !== "string") throw new ExplorerInputError("`assertionId` must be a string.");
  if (input.fixture !== undefined) {
    if (typeof input.fixture !== "string" || !Object.hasOwn(FIXTURES, input.fixture)) throw new ExplorerInputError(`Unknown fixture. Available: ${Object.keys(FIXTURES).join(", ")}`);
    const fx = FIXTURES[input.fixture];
    return { bundle: structuredClone(fx.bundle), evaluatedAt: fx.evaluatedAt, assertionId: input.assertionId, source: `fixture:${input.fixture}` };
  }
  if (!isObject(input.bundle) || typeof input.evaluatedAt !== "string") throw new ExplorerInputError("Provide either `fixture`, or `bundle` with `evaluatedAt`.");
  return { bundle: structuredClone(input.bundle), evaluatedAt: input.evaluatedAt, assertionId: input.assertionId, source: "supplied bundle" };
}

export function createExplorer({ command = "node", serverArgs, serverStderr }) {
  const instances = new Map();

  const mcp = (calls) => callTools({ command, args: serverArgs, calls, onStderr: serverStderr });

  function readinessInputs(bundle) {
    const assertions = Array.isArray(bundle.assertions) ? bundle.assertions : [];
    const ready = assertions.find((a) => isObject(a) && a.claimType === "VAULT_TECHNICAL_READINESS");
    if (!ready) return null;
    const derivation = (Array.isArray(bundle.derivations) ? bundle.derivations : []).find((d) => isObject(d) && d.id === ready.derivationId);
    const inputs = Array.isArray(derivation?.inputAssertionIds) ? derivation.inputAssertionIds : [];
    const byId = new Map(assertions.filter(isObject).map((a) => [a.id, a]));
    const identity = inputs.find((id) => byId.get(id)?.claimType === "ASSET_IDENTITY");
    const balance = inputs.find((id) => byId.get(id)?.claimType === "TOKEN_BALANCE_AT_BLOCK");
    return identity && balance ? { assertionId: ready.id, identityAssertionId: identity, balanceAssertionId: balance } : { assertionId: ready.id, missing: true };
  }

  async function evaluate(inst, withEvaluation) {
    const { bundle, evaluatedAt } = inst.input;
    const selected = inst.selectedId;
    const readiness = readinessInputs(bundle);
    const calls = [];
    if (withEvaluation) {
      calls.push({ key: "inspect", name: "inspect_evidence", arguments: { bundle, evaluatedAt } });
      calls.push({ key: "invariants", name: "check_invariants", arguments: { bundle, evaluatedAt } });
    }
    if (selected !== null) calls.push({ key: "provenance", name: "trace_provenance", arguments: { bundle, assertionId: selected } });
    if (withEvaluation && readiness && !readiness.missing) {
      calls.push({ key: "readiness", name: "assess_vault_readiness", arguments: { bundle, evaluatedAt, identityAssertionId: readiness.identityAssertionId, balanceAssertionId: readiness.balanceAssertionId } });
    }
    const results = await mcp(calls.map(({ name, arguments: args }) => ({ name, arguments: args })));
    const byKey = Object.fromEntries(calls.map((c, i) => [c.key, results[i]]));
    if (withEvaluation) {
      if (!byKey.inspect?.ok) throw Object.assign(new ExplorerInputError("The WalletWall MCP server rejected the bundle."), { code: byKey.inspect?.errorCode ?? "INVALID_INPUT" });
      inst.inspect = byKey.inspect.structured;
      inst.invariants = byKey.invariants?.ok ? byKey.invariants.structured : null;
      inst.readiness = readiness
        ? readiness.missing
          ? { assertionId: readiness.assertionId, errorCode: "REQUIRED_INPUT_ASSERTION_MISSING" }
          : byKey.readiness?.ok
            ? { assertionId: readiness.assertionId, result: byKey.readiness.structured }
            : { assertionId: readiness.assertionId, errorCode: byKey.readiness?.errorCode ?? "TOOL_ERROR" }
        : null;
    }
    inst.provenance = byKey.provenance?.ok ? byKey.provenance.structured : null;
  }

  function buildView(inst) {
    if (inst.error) return { status: "error", error: inst.error };
    if (!inst.input) return { status: "empty", fixtures: Object.entries(FIXTURES).map(([name, f]) => ({ name, title: f.title })) };
    const { bundle } = inst.input;
    const evalById = new Map((inst.inspect?.assertions ?? []).map((e) => [e.assertionId, e]));
    return {
      status: "ready",
      source: inst.input.source,
      evaluatedAt: inst.inspect.evaluatedAt,
      versions: inst.inspect.versions,
      bundleDigest: inst.inspect.bundleDigest,
      invariantViolationCount: inst.inspect.invariantViolationCount,
      invariantViolations: inst.invariants?.violations ?? [],
      assertions: bundle.assertions.map((a) => ({ id: a.id, claimType: a.claimType, origin: a.origin, temporality: a.temporality, subject: a.subject, value: a.value, derivationId: a.derivationId, evaluation: evalById.get(a.id) ?? null })),
      observations: bundle.observations,
      sources: bundle.sources,
      derivations: Array.isArray(bundle.derivations) ? bundle.derivations : [],
      selectedId: inst.selectedId,
      provenance: inst.provenance,
      readiness: inst.readiness,
    };
  }

  /** What an agent needs to describe the panel without re-deriving anything: the returned MCP results, verbatim. */
  function summary(inst) {
    const view = buildView(inst);
    if (view.status !== "ready") return view.status === "error" ? { status: "error", error: view.error } : { status: "empty" };
    return {
      status: "ready",
      source: view.source,
      evaluatedAt: view.evaluatedAt,
      bundleDigest: view.bundleDigest,
      versions: view.versions,
      invariantViolationCount: view.invariantViolationCount,
      selectedAssertionId: view.selectedId,
      assertions: view.assertions.map((a) => ({ id: a.id, claimType: a.claimType, evaluation: a.evaluation })),
      readiness: view.readiness,
    };
  }

  function broadcast(inst) {
    for (const res of inst.clients) res.write("data: update\n\n");
  }

  async function load(inst, input) {
    inst.error = null;
    try {
      inst.input = normalizeInput(input);
      inst.selectedId = inst.input.assertionId ?? defaultSelection(inst.input.bundle);
      if (inst.selectedId !== null && !(Array.isArray(inst.input.bundle.assertions) && inst.input.bundle.assertions.some((a) => isObject(a) && a.id === inst.selectedId))) inst.selectedId = defaultSelection(inst.input.bundle);
      await evaluate(inst, true);
    } catch (e) {
      inst.input = null;
      inst.inspect = inst.invariants = inst.provenance = inst.readiness = null;
      inst.selectedId = null;
      inst.error = { code: typeof e?.code === "string" ? e.code : "INVALID_INPUT", message: e instanceof ExplorerInputError ? e.message : "The WalletWall MCP server could not evaluate this request." };
    }
    broadcast(inst);
    return summary(inst);
  }

  async function select(inst, assertionId) {
    if (!inst.input || typeof assertionId !== "string" || !inst.input.bundle.assertions.some((a) => a.id === assertionId)) return summary(inst);
    inst.selectedId = assertionId;
    try {
      await evaluate(inst, false);
    } catch {
      inst.provenance = null;
    }
    broadcast(inst);
    return summary(inst);
  }

  function start(inst) {
    const pathKey = randomBytes(18).toString("base64url");
    const server = createServer((req, res) => {
      const host = req.headers.host ?? "";
      const port = server.address().port;
      const prefix = `/${pathKey}/`;
      const reject = (code) => {
        res.writeHead(code, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
        res.end(code === 404 ? "Not found" : code === 415 ? "Unsupported media type" : "Forbidden");
      };
      if (host !== `127.0.0.1:${port}`) return reject(403);
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (!url.pathname.startsWith(prefix)) return reject(404);
      const route = url.pathname.slice(prefix.length);
      const common = { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
      if (req.method === "GET" && route === "") {
        const nonce = randomBytes(16).toString("base64");
        // Fonts and brand images are embedded in the page as data: URIs (brand.mjs). data: is the only extra source: the
        // page still cannot request anything from any origin other than its own loopback listener.
        res.writeHead(200, {
          ...common,
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src data:; font-src data:; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'`,
        });
        res.end(renderPage({ nonce }));
      } else if (req.method === "GET" && route === "view") {
        // A fragment fetched by the page. If someone navigates to it directly it must still run nothing and load nothing.
        res.writeHead(200, { ...common, "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; base-uri 'none'; form-action 'none'; sandbox" });
        res.end(renderView(buildView(inst)));
      } else if (req.method === "GET" && route === "events") {
        res.writeHead(200, { ...common, "content-type": "text/event-stream", connection: "keep-alive" });
        res.write("retry: 2000\n\n");
        inst.clients.add(res);
        req.on("close", () => inst.clients.delete(res));
      } else if (req.method === "POST" && route === "select") {
        // The only state-changing route. It needs the unguessable path key and the exact Host, and in addition it refuses any
        // browser-declared foreign Origin and any body that is not JSON, so a page on another origin cannot drive it.
        const origin = req.headers.origin;
        if (origin !== undefined && origin !== `http://127.0.0.1:${port}`) return reject(403);
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")) return reject(415);
        let body = "";
        req.on("data", (c) => {
          body += c;
          if (body.length > 4096) req.destroy();
        });
        req.on("end", () => {
          let id;
          try {
            id = JSON.parse(body).assertionId;
          } catch {
            id = undefined;
          }
          void select(inst, id).then(() => {
            res.writeHead(204, common);
            res.end();
          });
        });
      } else reject(404);
    });
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        inst.server = server;
        inst.url = `http://127.0.0.1:${server.address().port}/${pathKey}/`;
        resolve();
      });
    });
  }

  return {
    async open(instanceId, input) {
      let inst = instances.get(instanceId);
      if (!inst) {
        inst = { input: null, inspect: null, invariants: null, provenance: null, readiness: null, selectedId: null, error: null, clients: new Set(), server: null, url: "" };
        instances.set(instanceId, inst);
        await start(inst);
      }
      if (input !== undefined && input !== null && Object.keys(input).length > 0) await load(inst, input);
      return { url: inst.url, title: "WalletWall", status: inst.input ? `${inst.input.source}` : "empty" };
    },
    async setInput(instanceId, input) {
      const inst = instances.get(instanceId);
      if (!inst) throw new ExplorerInputError("The canvas instance is not open.");
      return load(inst, input);
    },
    async select(instanceId, assertionId) {
      const inst = instances.get(instanceId);
      if (!inst) throw new ExplorerInputError("The canvas instance is not open.");
      return select(inst, assertionId);
    },
    view(instanceId) {
      const inst = instances.get(instanceId);
      if (!inst) throw new ExplorerInputError("The canvas instance is not open.");
      return summary(inst);
    },
    /** The authoritative Canvas view the page is rendered from, as a frozen copy. Read-only; not an agent action. */
    canvasView(instanceId) {
      const inst = instances.get(instanceId);
      if (!inst) throw new ExplorerInputError("The canvas instance is not open.");
      return deepFreeze(structuredClone(buildView(inst)));
    },
    async close(instanceId) {
      const inst = instances.get(instanceId);
      if (!inst) return;
      instances.delete(instanceId);
      for (const res of inst.clients) res.end();
      inst.clients.clear();
      inst.input = inst.inspect = inst.invariants = inst.provenance = inst.readiness = null;
      await new Promise((resolve) => {
        inst.server.close(() => resolve());
        inst.server.closeAllConnections();
      });
    },
    instanceCount: () => instances.size,
  };
}
