# TraceForge Deployment Readiness

Stage 6 ships a deployable package, not a credentialed public rollout. Public deployment still needs a server, DNS, TLS, and production secrets.

## Required Environment

- `DATABASE_URL`: PostgreSQL connection string for Console and Gateway.
- `MASTER_ENCRYPTION_KEY`: base64 encoded 32-byte key used by the Gateway to decrypt provider keys.
- `ADMIN_EMAIL`: single-admin Console email.
- `ADMIN_PASSWORD_HASH`: `plain:<password>`, `sha256:<digest>`, or raw sha256 digest.
- `TRACEFORGE_EVAL_GATEWAY_URL`: Console-side Eval runner gateway URL.
- `TRACEFORGE_EVAL_API_KEY`: gateway API key used by local EvalRun execution.
- `GATEWAY_ADDR`: gateway listen address, for example `0.0.0.0:8787`.
- `MOCK_ADDR`: mock upstream listen address, for example `0.0.0.0:8799`.

## Local Package Check

```bash
npm run build
npx prisma validate
npm run db:generate
cd gateway && cargo test && cargo check --examples
node scripts/verify-deploy-config.mjs
```

## Compose Shape

`docker-compose.yml` wires four services:

- `postgres` for shared storage.
- `console` for the Next.js control plane on port `3000`.
- `gateway` for the Rust data plane on port `8787`.
- `mock-upstream` for deterministic local provider behavior on port `8799`.

After secrets are set, use:

```bash
docker compose up --build
```

Then run database setup and demo scripts inside the console container or from a workstation pointed at the same database.

The current gateway image compiles with `cargo run --release` at container startup because `sqlx::query!` needs a live database unless offline metadata is prepared. For production-fast image builds, run `cargo sqlx prepare` against the target schema and switch `gateway/Dockerfile` back to a multi-stage binary build.

## Nginx Shape

`deploy/nginx/traceforge.conf` exposes:

- `/` -> Console.
- `/gateway/` -> Gateway API with buffering disabled for streaming.

Replace `traceforge.example.com` with the real host and add TLS in production.
