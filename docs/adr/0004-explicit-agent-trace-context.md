# Explicit Agent Trace context

Agent SDK runs need multiple Gateway calls in one tree, while ADR-0001 promises that reusing X-TraceForge-Run-Id is a conflict. We retain that contract and use mutually exclusive X-TraceForge-Agent-Run-Id plus optional X-TraceForge-Parent-Span-Id to join a running, same-project Agent-owned Run; this requires both gateway and trace_ingest scopes.

The Gateway reserves an LLM Span under a Run lock before dispatch, then completes that Span through the existing writer and recomputes Run totals without ending the Run. Manual lifecycle writes use the same lock; active children prevent parent/Run completion. An asynchronous writer failure leaves the reservation running and visible rather than falsely completing the Agent. The SDK waits for child completion through bounded reads before submitting an end operation, and never automatically retries model calls or lifecycle writes.
