import { createHash } from "node:crypto";

// Shared runtime contract. Read on demand so deployments can supply runtime values.
export function demoMode() {
  const value = process.env.DEMO_MODE ?? "false";
  if (value !== "true" && value !== "false") throw new Error("DEMO_MODE 必须为 true 或 false。");
  return value === "true";
}

export function adminConfig() {
  const demo = demoMode();
  const email = process.env.ADMIN_EMAIL?.trim() || (demo ? "demo@traceforge.local" : "");
  const passwordHash = process.env.ADMIN_PASSWORD_HASH?.trim() || (demo ? "plain:traceforge-demo" : "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("请配置合法的 ADMIN_EMAIL。");
  if (!/^(plain:.+|sha256:[a-f0-9]{64}|[a-f0-9]{64})$/i.test(passwordHash)) throw new Error("请配置合法的 ADMIN_PASSWORD_HASH。");
  const forbidden = ["traceforge-demo", "change-me"].some((password) => {
    const digest = createHash("sha256").update(password).digest("hex");
    return passwordHash === "plain:" + password || passwordHash.toLowerCase().replace(/^sha256:/, "") === digest;
  });
  if (!demo && forbidden) throw new Error("关闭 DEMO_MODE 后必须更换演示或占位密码。");
  return { email, passwordHash };
}

export function positiveInteger(name: string, fallback: number, maximum: number) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1 || number > maximum) throw new Error(name + " 超出有效范围 1–" + maximum + "。");
  return number;
}

export function gatewayConfig(kind: "CHAT" | "EVAL") {
  const prefix = "TRACEFORGE_" + kind;
  const apiKey = process.env[prefix + "_API_KEY"]?.trim();
  if (!apiKey) throw new Error("缺少 " + prefix + "_API_KEY。");
  const rawUrl = process.env[prefix + "_GATEWAY_URL"]?.trim() || "http://localhost:8787";
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error(prefix + "_GATEWAY_URL 必须为 HTTP(S) 地址。"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(prefix + "_GATEWAY_URL 必须为无凭据的 HTTP(S) 地址。");
  return { apiKey, url: url.toString().replace(/\/$/, ""), timeoutMs: positiveInteger(prefix + "_TIMEOUT_MS", 30_000, 120_000) };
}

export function evalLimits() {
  return { maxCases: positiveInteger("TRACEFORGE_EVAL_MAX_CASES", 20, 100), totalTimeoutMs: positiveInteger("TRACEFORGE_EVAL_TOTAL_TIMEOUT_MS", 120_000, 300_000) };
}
