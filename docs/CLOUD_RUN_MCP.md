# WalletWall MCP on Cloud Run

This deployment is an optional remote transport for the existing WalletWall MCP evidence engine. It does not replace the shipped Copilot stdio runtime.

## Boundary

- `packages/mcp/src/server.ts` remains the single six-tool / six-resource contract.
- Local execution still defaults to `127.0.0.1` and stdio remains the shipped Copilot transport.
- Cloud Run opts into a network listener explicitly with `--host 0.0.0.0`.
- The remote transport adds no BigQuery access, provider credentials, writes, signing, custody or transaction broadcast.
- `/health` is a fixed, no-store readiness endpoint. `/mcp` remains the only MCP route.
- The application does not implement its own bearer-token store. Authentication must be enforced before production exposure.
- Cloud deployment artifacts live under `scripts/cloud-run/`; the repository root stays reserved for stable project-level contracts and manifests.

## Build

Build from the repository root so the Docker context can include the MCP workspace while deployment-specific files remain namespaced:

```text
gcloud builds submit \
  --tag REGION-docker.pkg.dev/PROJECT/REPOSITORY/walletwall-mcp \
  --file scripts/cloud-run/Dockerfile \
  .
```

The Dockerfile-specific ignore file is `scripts/cloud-run/Dockerfile.dockerignore`, keeping unrelated plugin, docs, eval and conformance content out of the container build context where supported by the builder.

## Deploy

Create a dedicated Cloud Run service and keep it non-public until an authenticated ingress path is configured:

```text
gcloud run deploy walletwall-mcp \
  --image REGION-docker.pkg.dev/PROJECT/REPOSITORY/walletwall-mcp \
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

BigQuery-backed tools, rate limiting, public-client auth, custom-domain ingress and registry `remotes` metadata are separate lanes. Keeping them separate makes it possible to prove that this change only adds a deployable transport around the existing evidence contract.
