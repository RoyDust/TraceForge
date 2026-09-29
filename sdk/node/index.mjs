import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

/** Minimal Node SDK. API keys stay in the calling server process.
 * @param {{gatewayUrl:string,apiKey:string,timeoutMs?:number}} options
 */
export function createTraceClient({ gatewayUrl, apiKey, timeoutMs = 10000 }) {
  const base = new URL(gatewayUrl);
  if (!["http:", "https:"].includes(base.protocol) || !apiKey || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid TraceForge client configuration");
  const url = base.toString().replace(/\/$/, "") + "/api/traces/runs";
  const segment = (id) => encodeURIComponent(id);
  async function request(path, data, remainingMs = timeoutMs) {
    const response = await fetch(url + path, {
      method: data === undefined ? "GET" : "POST",
      headers: { authorization: "Bearer " + apiKey, "content-type": "application/json" },
      signal: AbortSignal.timeout(Math.max(1, remainingMs)),
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const body = await response.json();
    if (!response.ok) throw new Error("TraceForge HTTP " + response.status + ": " + (body.error?.message ?? "request failed"));
    return body;
  }
  // Gateway completion writes are asynchronous. Poll only reads; never retry writes/calls.
  async function waitForChildren(runId, parentId) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("TraceForge child Spans did not finish before the deadline");
      const run = await request("/" + segment(runId), undefined, remaining);
      const active = run.spans.some((span) => span.status === "running" && (parentId === undefined || span.parentId === parentId));
      if (!active) return;
      await delay(Math.min(50, Math.max(1, deadline - Date.now())));
    }
  }
  return {
    /** @param {{id?:string,name:string,input?:string}} options */
    async startRun({ id = randomUUID(), name, input }) {
      return (await request("", { id, name, input })).id;
    },
    /** @param {string} runId
     * @param {{id?:string,name:string,type:"tool"|"workflow"|"db"|"review",parentId?:string,input?:string}} options
     */
    async startSpan(runId, { id = randomUUID(), name, type, parentId, input }) {
      return (await request("/" + segment(runId) + "/spans", { id, name, type, parentId, input })).id;
    },
    /** @param {string} runId
     * @param {string} spanId
     * @param {{status?:"success"|"failed"|"cancelled",output?:string,errorCode?:string,error?:string}} options
     */
    async endSpan(runId, spanId, { status = "success", output, errorCode, error } = {}) {
      await waitForChildren(runId, spanId);
      return request("/" + segment(runId) + "/spans/" + segment(spanId) + "/end", { status, output, errorCode, error });
    },
    /** @param {string} runId
     * @param {{status?:"success"|"failed"|"cancelled",output?:string,errorCode?:string}} options
     */
    async endRun(runId, { status = "success", output, errorCode } = {}) {
      await waitForChildren(runId);
      return request("/" + segment(runId) + "/end", { status, output, errorCode });
    },
  };
}
