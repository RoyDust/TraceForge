import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { adminConfig, demoMode, gatewayConfig, evalLimits } from "../../lib/env";
import { field, enumField, jsonField, idField } from "../../lib/validation";
import { p95, average } from "../../lib/ui-metrics";

test("explicit demo defaults never activate just because NODE_ENV is development", () => {
  const old = { ...process.env };
  try {
    delete process.env.DEMO_MODE; delete process.env.ADMIN_EMAIL; delete process.env.ADMIN_PASSWORD_HASH;
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    assert.equal(demoMode(), false); assert.throws(adminConfig, /ADMIN_EMAIL/);
    process.env.DEMO_MODE = "true"; (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    assert.equal(adminConfig().passwordHash, "plain:traceforge-demo");
    process.env.DEMO_MODE = "false"; assert.throws(adminConfig, /ADMIN_EMAIL/);
    process.env.DEMO_MODE = "typo"; assert.throws(demoMode, /DEMO_MODE/);
  } finally { process.env = old; }
});
test("gateway configuration fails closed and limits remain bounded", () => {
  const old = { ...process.env };
  try {
    delete process.env.TRACEFORGE_EVAL_API_KEY; assert.throws(() => gatewayConfig("EVAL"), /API_KEY/);
    process.env.TRACEFORGE_EVAL_API_KEY = "test"; process.env.TRACEFORGE_EVAL_GATEWAY_URL = "file:///tmp/x";
    assert.throws(() => gatewayConfig("EVAL"), /HTTP/);
    process.env.TRACEFORGE_EVAL_MAX_CASES = "101"; assert.throws(evalLimits, /MAX_CASES/);
  } finally { process.env = old; }
});
test("validation rejects malformed UUID, JSON, enum and oversized text", () => {
  const form = new FormData();
  assert.throws(() => field(form,"name"), /不能为空/);
  form.set("name", "12345"); assert.throws(() => field(form,"name",4), /超过/);
  form.set("id", "bad"); assert.throws(() => idField(form,"id"), /ID/);
  form.set("json", "{"); assert.throws(() => jsonField(form,"json"), /JSON/);
  form.set("pass", "yes"); assert.throws(() => enumField(form,"pass",["true","false"]), /有效选项/);
});
test("percentiles use the full sample and ignore absent/invalid measurements", () => {
  assert.equal(p95([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,1000]),19);
  assert.equal(average([100,200,300]),200); assert.equal(p95([]),null); assert.equal(average([NaN]),null);
});

test("Demo credentials and placeholders cannot be reused with Demo Mode off, even hashed", () => {
  const old = { ...process.env };
  try {
    process.env.DEMO_MODE = "false"; process.env.ADMIN_EMAIL = "admin@example.com";
    for (const password of ["traceforge-demo", "change-me"]) {
      const digest = createHash("sha256").update(password).digest("hex");
      for (const configured of ["plain:" + password, "sha256:" + digest, digest]) {
        process.env.ADMIN_PASSWORD_HASH = configured;
        assert.throws(adminConfig, /必须更换/);
      }
    }
  } finally { process.env = old; }
});

test("all six existing Eval assertion modes remain available", async () => {
  const { evaluateAssertion } = await import("../../lib/eval-runner");
  const base = { id: "fixture", input: "test", expectedOutput: "hello", assertionConfig: null };
  assert.equal(evaluateAssertion({ ...base, assertionType: "exact_match" }, "hello").status, "passed");
  assert.equal(evaluateAssertion({ ...base, assertionType: "contains" }, "say hello").status, "passed");
  assert.equal(evaluateAssertion({ ...base, assertionType: "regex", assertionConfig: { pattern: "^hello$" } }, "hello").status, "passed");
  assert.equal(evaluateAssertion({ ...base, assertionType: "json_schema", assertionConfig: { required: ["answer"], properties: { answer: { type: "string" } } } }, '{"answer":"hello"}').status, "passed");
  assert.throws(() => evaluateAssertion({ ...base, assertionType: "llm_judge", assertionConfig: { pass_keywords: ["hello"] } }, "hello"), /必须通过 Gateway/);
  assert.equal(evaluateAssertion({ ...base, assertionType: "manual_review" }, "hello").status, "needs_review");
});
