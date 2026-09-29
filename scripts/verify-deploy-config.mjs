// Validate actual runtime values; never print secrets.
import "dotenv/config";
import { adminConfig, demoMode, gatewayConfig, evalLimits } from "../lib/env.ts";

const checks = {
  "Demo Mode / administrator": () => { demoMode(); adminConfig(); },
  "Chat gateway": () => gatewayConfig("CHAT"),
  "Eval gateway / limits": () => { gatewayConfig("EVAL"); evalLimits(); },
  "PostgreSQL": () => {
    let url;
    try { url = new URL(process.env.DATABASE_URL); } catch { throw new Error("DATABASE_URL 必须为 PostgreSQL 地址。"); }
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname.length < 2) throw new Error("DATABASE_URL 必须包含 PostgreSQL 主机和数据库名。");
    const schema = url.searchParams.get("schema");
    if (schema && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) throw new Error("DATABASE_URL schema 无效。");
  },
  "Provider encryption key": () => {
    const key = process.env.MASTER_ENCRYPTION_KEY?.trim();
    if (!key || Buffer.from(key, "base64").length !== 32 || Buffer.from(key, "base64").toString("base64") !== key) throw new Error("MASTER_ENCRYPTION_KEY 必须为 32 字节 base64。");
  },
};
let failed = false;
for (const [name, check] of Object.entries(checks)) {
  try { check(); console.log("ok " + name); }
  catch (error) { failed = true; console.error(name + ": " + error.message); }
}
if (failed) process.exitCode = 1;
else console.log("Runtime deployment configuration is valid; network readiness is verified separately.");
