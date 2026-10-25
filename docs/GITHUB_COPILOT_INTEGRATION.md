# GitHub Copilot integration record

Purpose: record what was verified against current official documentation and against the real Copilot CLI and Desktop app, and which assumptions remain. Dates of verification: **2026-10-23** (foundation lane) and **2026-10-24** (Desktop lane). Re-verify before any release; these formats are moving.

## Official documentation consulted

| Topic | Source |
| --- | --- |
| Plugins overview, supported surfaces, formats | https://docs.github.com/en/copilot/concepts/customizations/plugins (redirect from `/concepts/agents/copilot-cli/about-cli-plugins`) |
| Plugin manifest, Agent Plugins 1.0 fields, component locations, `${PLUGIN_ROOT}`/`${PLUGIN_DATA}`, install specifications | https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference |
| Agent Plugins 1.0.0 specification (manifest, `mcp.json`, skills discovery, containment rules) | https://github.com/agentplugins/agent-plugins-spec/blob/main/spec/1.0.0.md |
| GitHub App registration from a manifest | https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest |
| Circle USDC contract addresses (registry cross-check) | https://developers.circle.com/stablecoins/usdc-contract-addresses |

## Spec and version drift recorded in the Desktop lane (2026-10-24)

| Item | Foundation lane (2026-10-23) | Desktop lane (2026-10-24) | Effect |
| --- | --- | --- | --- |
| Copilot CLI | 1.0.103 (npm, temp install) | 1.0.103 (the runtime bundled with Desktop, `copilot-sdk-runtime-1.0.102-0.unstable...`) | none |
| Copilot Desktop app | not recorded | **1.1.31** | recorded |
| Plugin docs | CLI-centric | Now document the Desktop path: **Customize → Plugins**, marketplace dropdown, marketplace settings icon, "add the GitHub repository or Git URL that hosts the marketplace", Install | the Desktop flow can be followed from documentation; adding a marketplace is documented for a GitHub repository or Git URL, while the CLI also accepts a local directory |
| Canvas docs | no official page fetched | official page fetched (see below) | Canvas section rewritten |
| Direct installs | deprecated message in the CLI | unchanged (`copilot plugin install <path>` still works) | the marketplace path is used instead |
| Agent Plugins schema | `1.0.0` | `1.0.0`; the docs also recognise `1.1.0` | none |

## Official documentation consulted in the Desktop lane

| Topic | Source |
| --- | --- |
| Customizing the GitHub Copilot app (Customize, Plugins, MCP, Canvas) | https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app |
| Working with canvas extensions in the GitHub Copilot app | https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions |
| Extensions for GitHub Copilot | https://docs.github.com/en/copilot/concepts/customizations/extensions |
| Creating extensions for GitHub Copilot CLI | https://docs.github.com/en/copilot/tutorials/create-an-extension |
| Plugins for GitHub Copilot; plugin reference and `marketplace.json` | https://docs.github.com/en/copilot/concepts/customizations/plugins, https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference |
| Circle, Tether and Sky authority publications (registry verification) | see `DATA_SOURCES.md` |

## Plugin format decision

Copilot supports two formats. We use **Agent Plugins 1.0** (the documentation recommends it for new plugins):

- `plugin/plugin.json` declares `$schema: https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`. Closed schema: only `$schema`, `name`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`, `extensions`. Name rules: 1–64 chars, `a-z 0-9 - .`, alphanumeric at both ends, no `--` or `..`.
- Skills only in `plugin/skills/<name>/SKILL.md` (fixed location).
- MCP servers only in `plugin/mcp.json` at the plugin root, `$schema: https://agent-plugins.org/schemas/1.0.0/mcp.schema.json`, `stdio` transport, `command` is a single token (`node`), args use `${PLUGIN_ROOT}`.
- No hooks, agents, commands, LSP or `com.github.copilot/` directory in v0.1.

**Display name.** The manifest `name` must be lowercase, so the identifier is `walletwall`. The format has no display-name field; the product is presented as "WalletWall" in README, skill and docs. No client-specific display-name extension was added because none is documented.

**Repository layout vs. plugin root.** The plugin must be self-contained (a subdirectory install cannot reach `packages/`). The engine is therefore bundled to `plugin/server/walletwall-mcp.mjs` (committed, reproducible, hash-pinned in `security/bundle.sha512`). Install forms documented for the CLI: `copilot plugin install ./plugin`, or `OWNER/REPO:PATH` (`Wallet-Wall/walletwall-copilot:plugin`, requires access to the repository).

## Verified against the real client

Copilot CLI **1.0.103** (npm `@github/copilot`), installed into a temporary directory with `COPILOT_HOME` pointed at a temporary directory so no real configuration was touched:

- `copilot plugin install <path>/plugin` → `Plugin "walletwall" installed successfully. Installed 1 skill.`
- `copilot plugin list --json` → `walletwall`, version `0.1.0`, enabled.
- `copilot mcp list` → `Plugin servers: walletwall (local)`.

Observations: the CLI warns that **direct installs (repos, URLs, local paths) are deprecated** and that only `plugin@marketplace` installs will be supported in a future release. A marketplace is therefore needed eventually; creating or submitting to one is out of scope for this lane. The CLI creates a `plugin-data/` directory for the plugin; the server does not use it and writes nothing to it.

Desktop status (2026-10-24): the plugin was installed through the marketplace path into the real Copilot home and loaded by **new Desktop sessions** (tools, skill, canvas, MCP launch). The GUI click-through itself remains **NOT_PROVEN**; see `DESKTOP_INSTALL_PROOF.md`.

The server itself is proven to launch and answer over real stdio from the same bundled file (`e2e.test.ts`, `privacy/runtime.test.ts`).

## MCP

- Transport: stdio only. SDK: official `@modelcontextprotocol/sdk` 1.32.2 (pinned), low-level `Server` with static request handlers so that validation and error text are fully controlled.
- Capabilities advertised: `tools`, `resources`. No prompts, sampling, logging, roots or elicitation.
- Resources use the `walletwall://` scheme.
- Tool annotations: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false` on every tool.
- Responses return both `structuredContent` and a text rendering. No `outputSchema` is declared in 0.1 (deferred).

## Canvas

Re-verified 2026-10-24 against the official documentation and the runtime installed with the Desktop app:

- Working with canvas extensions in the GitHub Copilot app: canvases are listed under **Customize → Canvas**, can be included in a plugin alongside skills and MCP servers, live in `.github/extensions` (repository) or `~/.copilot/extensions` (user), and open in the right side panel. https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions
- Extensions for GitHub Copilot: "Plugin extensions are supplied as part of an installed plugin"; Copilot CLI extensions are described as experimental. https://docs.github.com/en/copilot/concepts/customizations/extensions
- The SDK shipped with the Desktop runtime (`copilot-sdk/canvas.d.ts`, `extension.d.ts`, `docs/extensions.md` under `%LOCALAPPDATA%\copilot\pkg\win32-x64\<runtime>\`) defines `joinSession({ canvases: [createCanvas({...})] })`, provider callbacks `open`, `onClose` and per-canvas `actions`, and marks the canvas types `@experimental`. The Copilot app embeds only loopback URLs, so a canvas serves its page from a `127.0.0.1` listener.

**Where a plugin's canvas lives (observed, not in the documentation table).** The plugin reference lists `agents/`, `commands/`, `rules/`, `hooks/` and `lsp.json` under `com.github.copilot/` for Agent Plugins 1.0, and does not list `extensions/`. A marketplace plugin already installed in the Desktop home (`cache-stats`) ships its canvas as `com.github.copilot/extensions/<name>/extension.mjs` plus `copilot-extension.json`, and the runtime loads it. WalletWall uses the same layout: `plugin/com.github.copilot/extensions/walletwall-evidence-explorer/`. The runtime registered it as `plugin:walletwall:walletwall-evidence-explorer` in both a CLI session and Desktop sessions. **This location is an undocumented-but-working convention and may change.**

Built in this lane: the WalletWall canvas (earlier called the Evidence Explorer; canvas id and folder `walletwall-evidence-explorer` are kept): `plugin/com.github.copilot/extensions/walletwall-evidence-explorer/`. It is not a general dashboard; it renders one bundle from the structured results of the bundled MCP server. See `plugin/README.md`, `docs/PLUGIN_PATH_PRIVACY.md` and `docs/DESKTOP_INSTALL_PROOF.md`.
## GitHub App

See `docs/GITHUB_APP.md`. No App is registered and the runtime does not use one.

## Assumptions that could break

1. Agent Plugins `$schema` values `1.0.0` and `1.1.0` are recognized by Copilot CLI; `1.0.0` is used.
2. Copilot expands `${PLUGIN_ROOT}` in `args` for stdio servers (documented in the CLI plugin reference; confirmed indirectly by `mcp list` resolving the server, not by launching it).
3. `node` is on the user's `PATH`. No Node binary is shipped.
4. The Copilot desktop app uses the same plugin loader as the CLI. (Observed to hold for tools, skill, MCP launch and canvas registration in Desktop 1.1.31.)
