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
- The remote transport adds no BigQuery access, provider credentials, writes, signing, custody or transaction broadcast.
- `/health` is a fixed, no-store readiness endpoint. `/mcp` remains the only MCP route.
- The application does not implement its own bearer-token store. Authentication must be enforced before production exposure.
- Cloud deployment artifacts live under `scripts/cloud-run/`; the repository root stays reserved for stable project-level contracts and manifests.

## Build

Build from the repository root so the Docker context can include the MCP workspace while deployment-specific files remain namespaced. The image target is explicit and supplied at invocation time:

```text
gcloud builds submit . \
  --config scripts/cloud-run/cloudbuild.yaml \
  --ignore-file scripts/cloud-run/gcloudignore \
  --substitutions _IMAGE=REGION-docker.pkg.dev/PROJECT/REPOSITORY/walletwall-mcp:TAG
```

The build config invokes Docker with `scripts/cloud-run/Dockerfile`. `scripts/cloud-run/gcloudignore` bounds the source uploaded to Cloud Build, and `scripts/cloud-run/Dockerfile.dockerignore` further bounds the Docker build context where supported by the builder.

## Deploy

Create a dedicated Cloud Run service and keep it non-public until an authenticated ingress path is configured:

```text
gcloud run deploy walletwall-mcp \
  --image REGION-docker.pkg.dev/PROJECT/REPOSITORY/walletwall-mcp:TAG \
  --region REGION \
  --no-allow-unauthenticated
```

Cloud Run supplies `PORT`; the container starts the bridge on `0.0.0.0:$PORT`.

## Endpoints

```text
GET  /health
POST /mcp
```

The first deployment should be tested on the generated `run.app` hostname before adding a custom domain. After the authenticated ingress is proven, `mcp.walletwall.org` can point at that GCP frontend while Vercel continues to host DNS for `walletwall.org`.

## Deliberately deferred

Vault-specific BigQuery-backed read tools/views, rate limiting, WalletWall Vault Guardian auth, public-client OAuth, custom-domain ingress and registry `remotes` metadata are separate lanes. Keeping them separate makes it possible to prove that this change only adds a deployable transport around the existing evidence contract.
