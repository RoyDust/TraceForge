"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

type ModelOption = {
  id: string;
  modelName: string;
  displayName: string | null;
  providerName: string;
};

type ChatMessage = {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  state?: "pending" | "done" | "error";
};

type DispatchResponse = {
  runId?: string;
  deadline?: number;
  receipt?: string;
  traceUrl?: string;
  error?: string;
};

type RunSnapshot = {
  id: string;
  name: string | null;
  status: "running" | "success" | "failed" | "cancelled";
  errorCode: string | null;
  inputPreview: string | null;
  outputPreview: string | null;
  totalTokens: number | null;
  cost: string | null;
  latencyMs: number | null;
  usageSource: string | null;
  startedAt: string;
  endedAt: string | null;
  model: string | null;
  provider: string | null;
  spanCount: number;
  eventTypes: string[];
  error: string | null;
};

type RunResponse = {
  run: RunSnapshot | null;
  error?: string;
};

const SYSTEM_PROMPT = "你是一个简洁的助手。";
const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content: "我已经准备好。发送一条消息后，左侧会同步显示这次 TraceRun 的实时状态。",
    state: "done",
  },
];

function formatCost(value: string | null) {
  if (!value) return "—";
  const number = Number(value);
  return Number.isFinite(number) ? `$${number.toFixed(8)}` : value;
}

function formatMs(value: number | null) {
  return value === null ? "—" : `${value} ms`;
}

function compactId(value: string | null) {
  return value ? `${value.slice(0, 8)}…${value.slice(-4)}` : "—";
}

function terminal(status: RunSnapshot["status"] | "pending" | null) {
  return status === "success" || status === "failed" || status === "cancelled";
}

function statusLabel(status: RunSnapshot["status"] | "pending" | null) {
  if (status === "pending") return "等待中";
  if (status === "running") return "运行中";
  if (status === "success") return "成功";
  if (status === "failed") return "失败";
  if (status === "cancelled") return "已取消";
  return "空闲";
}

export function ChatForm({ models, hasChatApiKey, defaultModel }: { models: ModelOption[]; hasChatApiKey: boolean; defaultModel?: string }) {
  const preferredModel = models.find((option) => option.modelName === "mock-ok") ?? models[0];
  const [model, setModel] = useState(defaultModel ?? preferredModel?.modelName ?? "");
  const [stream, setStream] = useState(false);
  const [input, setInput] = useState("Say hello from TraceForge.");
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [currentTraceUrl, setCurrentTraceUrl] = useState<string | null>(null);
  const [run, setRun] = useState<RunSnapshot | null>(null);
  const [runPending, setRunPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [receipt, setReceipt] = useState("");
  const assistantMessageId = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const selectedModel = models.find((option) => option.modelName === model);
  const disabledReason = useMemo(() => {
    if (!hasChatApiKey) return "缺少 TRACEFORGE_CHAT_API_KEY";
    if (models.length === 0) return "没有可用模型";
    if (!selectedModel) return "所选模型不可用，请重新选择。";
    return null;
  }, [hasChatApiKey, models.length, selectedModel]);
  const canSend = !disabledReason && !sending && input.trim().length > 0;
  const status = run?.status ?? (runPending ? "pending" : null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, run?.status]);

  useEffect(() => {
    if (!currentRunId || terminal(status) || !sending) return;

    let cancelled = false;
    const targetMessageId = assistantMessageId.current;
    async function tick() {
      if (cancelled || targetMessageId !== assistantMessageId.current) return;
      if (deadline && Date.now() >= deadline) {
        setError("未确认派发或运行尚未完成，已停止等待。请核对运行 ID 后再决定是否重新发送。");
        setRunPending(false); setSending(false); return;
      }
      try {
        const response = await fetch("/chat/runs/" + currentRunId + "?pending=" + encodeURIComponent(receipt), { cache: "no-store", signal: AbortSignal.timeout(5000) });
        const body = (await response.json().catch(() => ({}))) as RunResponse;
        if (cancelled || targetMessageId !== assistantMessageId.current) return;
        if (!response.ok) {
          setSending(false);
          setRunPending(false);
          setError(body.error ?? `读取 TraceRun 失败 (${response.status})。`);
          return;
        }
        setRun(body.run);
        setRunPending(!body.run);
        if (!body.run || !assistantMessageId.current) return;

        if (body.run.status === "success") {
          const content = body.run.outputPreview?.trim() || "完成，但没有输出预览。";
          setMessages((items) => items.map((item) => (item.id === assistantMessageId.current ? { ...item, content, state: "done" } : item)));
          setSending(false);
        }
        if (body.run.status === "failed" || body.run.status === "cancelled") {
          const content = body.run.error || body.run.errorCode || "调用失败。";
          setMessages((items) => items.map((item) => (item.id === assistantMessageId.current ? { ...item, content, state: "error" } : item)));
          setSending(false);
        }
      } catch (pollError) {
        if (!cancelled) {
          setError(pollError instanceof Error ? pollError.message : "读取 TraceRun 失败。");
        }
      }
    }

    tick();
    const timer = window.setInterval(tick, 1200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [currentRunId, status, sending, deadline, receipt]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = input.trim();
    if (!content || !canSend) return;

    const previousConversation = messages
      .filter((message) => message.role === "user" || (message.role === "assistant" && message.state === "done"))
      .map((message) => ({ role: message.role, content: message.content }));
    const gatewayMessages = [{ role: "system", content: SYSTEM_PROMPT }, ...previousConversation, { role: "user", content }];
    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();

    assistantMessageId.current = assistantId;
    setMessages((items) => [
      ...items,
      { id: userId, role: "user", content, state: "done" },
      { id: assistantId, role: "assistant", content: "等待网关接受请求…", state: "pending" },
    ]);
    setInput("");
    setRun(null);
    setCurrentRunId(null);
    setCurrentTraceUrl(null);
    setDeadline(null);
    setReceipt("");
    setRunPending(true);
    setError(null);
    setSending(true);

    try {
      const response = await fetch("/chat/dispatch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, messages: gatewayMessages, stream }),
      });
      const body = (await response.json().catch(() => ({}))) as DispatchResponse;
      if (!response.ok || !body.runId) {
        const message = body.error ?? `发送失败 (${response.status})。`;
        setError(message);
        setRunPending(false);
        setSending(false);
        setMessages((items) => items.map((item) => (item.id === assistantId ? { ...item, content: message, state: "error" } : item)));
        return;
      }
      setDeadline(body.deadline ?? Date.now() + 45000);
      setReceipt(body.receipt ?? "");
      setCurrentRunId(body.runId);
      setCurrentTraceUrl(body.traceUrl ?? `/traces/${body.runId}?pending=1`);
    } catch (dispatchError) {
      const message = dispatchError instanceof Error ? dispatchError.message : "发送失败。";
      setError(message);
      setRunPending(false);
      setSending(false);
      setMessages((items) => items.map((item) => (item.id === assistantId ? { ...item, content: message, state: "error" } : item)));
    }
  }

  return (
    <div className="chat-workbench">
      <aside className="chat-live-panel" aria-label="当前对话实时信息">
        <section className="section-band">
          <div className="chat-panel-head">
            <div>
              <p className="eyebrow">实时运行</p>
              <h2>当前对话</h2>
            </div>
            <span className={status ? `badge ${status}` : "badge"}>{statusLabel(status)}</span>
          </div>

          <div className="kv-grid single-column">
            <div className="kv">
              <small>运行 ID</small>
              <strong>{compactId(currentRunId)}</strong>
            </div>
            <div className="kv">
              <small>模型</small>
              <strong>{selectedModel ? `${selectedModel.providerName} / ${selectedModel.displayName ?? selectedModel.modelName}` : "—"}</strong>
            </div>
            <div className="kv">
              <small>模式</small>
              <strong>{stream ? "流式" : "非流式"}</strong>
            </div>
            <div className="kv">
              <small>供应商</small>
              <strong>{run?.provider ?? selectedModel?.providerName ?? "—"}</strong>
            </div>
            <div className="kv">
              <small>延迟</small>
              <strong>{formatMs(run?.latencyMs ?? null)}</strong>
            </div>
            <div className="kv">
              <small>令牌</small>
              <strong>{run?.totalTokens ?? "—"}</strong>
            </div>
            <div className="kv">
              <small>成本</small>
              <strong>{formatCost(run?.cost ?? null)}</strong>
            </div>
          </div>

          {run?.errorCode ? (
            <div className="chat-error-note">
              <strong>{run.errorCode}</strong>
              <span>{run.error ?? "调用失败，打开追踪运行查看详情。"}</span>
            </div>
          ) : null}

          <div className="chat-event-strip">
            {(run?.eventTypes.length ? run.eventTypes : status === "pending" ? ["pending"] : ["ready"]).slice(-5).map((eventType, index) => (
              <span key={`${eventType}-${index}`}>{eventType}</span>
            ))}
          </div>

          {currentTraceUrl ? (
            <a className="button secondary chat-trace-link" href={currentTraceUrl}>
              打开追踪运行
            </a>
          ) : null}
        </section>

        <section className="section-band">
          <h2>设置</h2>
          <label>
            模型
            <select value={model} onChange={(event) => setModel(event.target.value)} disabled={models.length === 0 || sending}>
              {!selectedModel ? <option value={model} disabled>请选择可用模型</option> : null}
              {models.map((option) => (
                <option key={option.id} value={option.modelName}>
                  {option.providerName} / {option.displayName ?? option.modelName}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={stream} onChange={(event) => setStream(event.target.checked)} disabled={sending} />
            流式输出
          </label>
          {disabledReason ? <p className="form-error">{disabledReason}</p> : null}
        </section>
      </aside>

      <section className="chat-conversation" aria-label="智能体对话">
        <div className="chat-thread">
          {messages.map((message) => (
            <article className={`chat-bubble ${message.role} ${message.state ?? ""}`} key={message.id}>
              <small>{message.role === "user" ? "你" : "TraceForge 智能体"}</small>
              <p>{message.content}</p>
            </article>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <form className="chat-composer" onSubmit={onSubmit}>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          {models.length === 0 ? (
            <div className="empty-state">
              <h2>没有可用模型</h2>
              <p className="muted">当前没有启用的模型配置。</p>
            </div>
          ) : null}
          <label>
            消息
            <textarea
              className="chat-message-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="输入一条消息..."
              rows={3}
              disabled={Boolean(disabledReason)}
            />
          </label>
          <button type="submit" disabled={!canSend}>
            {sending ? "等待响应" : "发送消息"}
          </button>
        </form>
      </section>
    </div>
  );
}
