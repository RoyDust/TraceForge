export type ResponsibilityDomain = "模型" | "网络" | "限流" | "工具" | "业务" | "网关拒绝";

export type SpanForResponsibility = {
  type: string;
  status: string;
  errorCode: string | null;
};

export type RunForResponsibility = {
  status: string;
  errorCode: string | null;
  spans: SpanForResponsibility[];
};

const MODEL_ERRORS = new Set([
  "upstream_error",
  "provider_rate_limited",
  "provider_auth_failed",
  "fallback_failed",
]);

const NETWORK_ERRORS = new Set(["upstream_timeout", "stream_interrupted", "stream_timeout"]);
const LIMIT_ERRORS = new Set(["rate_limited", "concurrency_limited"]);
const GATEWAY_REJECT_ERRORS = new Set(["invalid_api_key", "revoked_api_key"]);

export function responsibilityFor(errorCode: string | null | undefined, spanType?: string | null) {
  if (!errorCode) return null;

  if (LIMIT_ERRORS.has(errorCode)) return "限流" satisfies ResponsibilityDomain;
  if (GATEWAY_REJECT_ERRORS.has(errorCode)) return "网关拒绝" satisfies ResponsibilityDomain;

  if (spanType === "tool") return "工具" satisfies ResponsibilityDomain;
  if (spanType === "workflow" || spanType === "db" || spanType === "review") {
    return "业务" satisfies ResponsibilityDomain;
  }

  if (spanType === "llm") {
    if (MODEL_ERRORS.has(errorCode)) return "模型" satisfies ResponsibilityDomain;
    if (NETWORK_ERRORS.has(errorCode)) return "网络" satisfies ResponsibilityDomain;
    if (errorCode === "client_cancelled") return "业务" satisfies ResponsibilityDomain;
  }

  return null;
}

export function responsibilityForRun(run: RunForResponsibility) {
  const suspiciousSpan =
    run.spans.find((span) => span.errorCode) ??
    run.spans.find((span) => span.status === "failed" || span.status === "cancelled");
  if (suspiciousSpan) {
    return responsibilityFor(suspiciousSpan.errorCode, suspiciousSpan.type);
  }
  return responsibilityFor(run.errorCode, null);
}

export function responsibilityDescription(domain: ResponsibilityDomain | null) {
  switch (domain) {
    case "模型":
      return "上游模型服务、Provider 鉴权、Provider 限流或 fallback 链路失败。";
    case "网络":
      return "连接、超时或流式传输中断导致响应不完整。";
    case "限流":
      return "TraceForge 网关在请求到达模型前执行了 RPM 或并发限制。";
    case "工具":
      return "Agent 工具 Span 失败，需要检查工具调用入参、外部服务或返回结构。";
    case "业务":
      return "业务工作流、数据库、人工审核或客户端取消导致 Run 没有正常完成。";
    case "网关拒绝":
      return "请求未进入模型层，通常是 API Key 无效、撤销或缺少权限。";
    default:
      return "当前错误码没有映射到责任域。";
  }
}
