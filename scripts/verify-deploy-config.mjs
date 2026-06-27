import { readFileSync } from "node:fs";

const checks = [
  ["docker-compose.yml", ["postgres:", "console:", "gateway:", "mock-upstream:", "3000:3000", "8787:8787", "8799:8799", "TRACEFORGE_EVAL_GATEWAY_URL", "TRACEFORGE_EVAL_API_KEY"]],
  ["Dockerfile.console", ["npm ci", "npm run db:generate", "npm run build", "EXPOSE 3000"]],
  ["gateway/Dockerfile", ["cargo", "run", "--release", "traceforge-gateway", "EXPOSE 8787"]],
  ["deploy/nginx/traceforge.conf", ["proxy_pass http://console:3000", "proxy_pass http://gateway:8787", "proxy_buffering off"]],
  [".github/workflows/deploy-readiness.yml", ["npm run build", "npx prisma validate", "cargo test", "cargo check --examples", "node scripts/verify-deploy-config.mjs"]],
  ["DEPLOYMENT.md", ["DATABASE_URL", "MASTER_ENCRYPTION_KEY", "ADMIN_EMAIL", "TRACEFORGE_EVAL_GATEWAY_URL", "docker compose up --build"]],
];

let failed = false;
for (const [file, needles] of checks) {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    console.error(`missing ${file}: ${error}`);
    failed = true;
    continue;
  }
  const missing = needles.filter((needle) => !text.includes(needle));
  if (missing.length > 0) {
    console.error(`${file} missing: ${missing.join(", ")}`);
    failed = true;
  } else {
    console.log(`ok ${file}`);
  }
}

if (failed) process.exit(1);
console.log("Deployment readiness config looks complete.");
