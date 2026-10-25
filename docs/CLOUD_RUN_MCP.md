# WalletWall MCP on Cloud Run

This deployment is an optional remote transport for the existing WalletWall MCP evidence engine. It does not replace the shipped Copilot stdio runtime.

## Initial hosted product scope: WalletWall Vault

The first hosted consumer is **WalletWall Vault**, specifically the Vault Guardian / migration-readiness workflow. The hosted MCP is infrastructure for Vault, not a new general-purpose blockchain API or a separate WalletWall product.

- The shared MCP core remains transport-neutral and reusable.
- The first hosted tool/data profile is Vault-oriented: readiness, blockers, asset identity, evidence quality, invariants and provenance.
- Future BigQuery integration must use purpose-built Vault read models/views rather than arbitrary SQL or broad dataset access.
- The hosted path must remain read-only: no signing, custody, transaction construction/broadcast, swaps, trading or wallet mutation.
- Other WalletWall products may reuse the shared core later, but they do not broaden the initial hosted authority or data-access boundary.

## Boundary

- `packages/mcp/src/server.ts` remains the single six-tool / six-resource contract.
- Local execution still defaults to `127.0.0.1` and stdio remains the shipped Copilot transport.
- Cloud Run opts into a network listener explicitly with `--host 0.0.0.0`.
- The remote transport is stateless: each POST gets a fresh MCP server/transport and no MCP session ID is issued.
- The remote transport adds no BigQuery access, provider credentials, writes, signing, custody or transaction broadcast.
- `/health` is a fixed, no-store readiness endpoint. `/mcp` remains the only MCP route.
- Browser Origins are rejected in non-loopback mode. MCP callers are expected to be machine-to-machine clients.
- Request bodies are capped at 512 KiB and URLs at 256 characters before MCP dispatch.
- The container runs as the non-root `node` user and does not use a shell entrypoint.
- Cloud deployment artifacts remain namespaced under `scripts/cloud-run/`.

## Port selection

The bridge selects its listening port in this order:

1. explicit `--port` CLI value;
2. `PORT` environment variable;
3. local default `8787`.

Invalid configured ports fail closed. Cloud Run injects `PORT`; the container therefore does not hardcode a CLI port. `EXPOSE 8080` is image metadata only and does not override the runtime port.

## Authentication boundary

Do not conflate Cloud Run IAM with public MCP authentication.

For the first private Vault smoke deployment, keep the service non-public and use GCP-native authenticated invocation. That proves the container and transport without creating a public WalletWall endpoint.

Before any Anthropic-hosted or public client uses this service, add a separate MCP-compatible authentication lane. The initial hosted consumer is the WalletWall-owned **Vault Guardian**; a high-entropy static bearer is sufficient for that narrow first-party lane. OAuth belongs to later multi-user/public remote access.

Do not publish the endpoint in the MCP Registry before that boundary is proven.

## Build

Build from the repository root so the Docker context can include the MCP workspace while deployment-specific files remain namespaced:

```text
gcloud builds submit . \
  --config scripts/cloud-run/cloudbuild.yaml \
  --ignore-file scripts/cloud-run/gcloudignore \
  --substitutions _IMAGE=REGION-docker.pkg.dev/PROJECT/REPOSITORY/walletwall-mcp:TAG
```

The build config invokes Docker with `scripts/cloud-run/Dockerfile`.

## Private Vault smoke deploy

Create a dedicated Cloud Run service, keep it non-public, and cap scaling while behavior is being proven:

```text
gcloud run deploy walletwall-mcp \
  --image REGION-docker.pkg.dev/PROJECT/REPOSITORY/walletwall-mcp:TAG \
  --region REGION \
  --min 0 \
  --max 3 \
  --concurrency 8 \
  --timeout 30s \
  --no-allow-unauthenticated
```

Cloud Run supplies `PORT`, and the container starts the bridge on `0.0.0.0:$PORT` without a shell entrypoint. The hard cap on instances is an initial cost/abuse guard, not a final capacity recommendation; change it only after measured Vault load testing.

## Endpoints

```text
GET  /health
HEAD /health
POST /mcp
```

The first deployment should be tested on the generated `run.app` hostname with authenticated invocation before adding any custom domain.

## Production edge (later lane)

The intended production path is:

```text
Vault Guardian / authenticated client
        |
        v
mcp.walletwall.org
        |
external HTTPS load balancer
        |
Cloud Armor / coarse abuse controls
        |
Cloud Run with ingress restricted to the load-balancer path
        |
dedicated read-only Vault service identity
        |
purpose-built Vault read models/views
```

Application/MCP authentication is separate from the network/load-balancer boundary. Exact `Host` validation belongs in that lane once `mcp.walletwall.org` is the canonical hostname.

## Deliberately deferred

The following remain separate reviewable lanes:

- WalletWall Vault Guardian bearer authentication;
- public OAuth / per-user authorization;
- custom-domain and load-balancer ingress;
- Cloud Armor and application-level rate limits;
- Vault-specific BigQuery-backed read-only tools and dedicated views/service identity;
- per-tool query ceilings and cost controls;
- container base-image digest pinning and release provenance;
- MCP Registry `remotes` metadata.

Keeping these separate makes it possible to prove what each new trust boundary changes.
