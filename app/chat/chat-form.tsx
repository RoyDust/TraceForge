"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type ModelOption = {
  id: string;
  modelName: string;
  displayName: string | null;
  providerName: string;
};

type DispatchResponse = {
  runId?: string;
  traceUrl?: string;
  error?: string;
};

const DEFAULT_MESSAGES = JSON.stringify(
  [
    { role: "system", content: "You are a concise assistant." },
    { role: "user", content: "Say hello from TraceForge." },
  ],
  null,
  2,
);

function validateMessages(value: unknown) {
  if (!Array.isArray(value)) return "messages 必须是数组。";
  if (value.length === 0) return "messages 至少需要一条消息。";
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return `messages[${index}] 必须是对象。`;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.role !== "string" || !record.role.trim()) {
      return `messages[${index}].role 不能为空。`;
    }
    if (!("content" in record)) {
      return `messages[${index}].content 必须存在。`;
    }
  }
  return null;
}

export function ChatForm({ models, hasChatApiKey }: { models: ModelOption[]; hasChatApiKey: boolean }) {
  const router = useRouter();
  const [model, setModel] = useState(models[0]?.modelName ?? "");
  const [messagesText, setMessagesText] = useState(DEFAULT_MESSAGES);
  const [stream, setStream] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const disabledReason = useMemo(() => {
    if (!hasChatApiKey) return "缺少 TRACEFORGE_CHAT_API_KEY，无法发送。";
    if (models.length === 0) return "没有可用的 active ModelConfig。";
    return null;
  }, [hasChatApiKey, models.length]);
  const canSend = !disabledReason && !sending;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    let messages: unknown;
    try {
      messages = JSON.parse(messagesText);
    } catch {
      setError("messages 不是合法 JSON。");
      return;
    }
    const validationError = validateMessages(messages);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSending(true);
    try {
      const response = await fetch("/chat/dispatch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, messages, stream }),
      });
      const body = (await response.json().catch(() => ({}))) as DispatchResponse;
      if (!response.ok || !body.traceUrl) {
        setError(body.error ?? `发送失败 (${response.status})。`);
        setSending(false);
        return;
      }
      router.push(body.traceUrl);
    } catch (dispatchError) {
      setError(dispatchError instanceof Error ? dispatchError.message : "发送失败。");
      setSending(false);
    }
  }

  return (
    <div className="detail-grid chat-grid">
      <section className="section">
        <form className="stack-form chat-form" onSubmit={onSubmit}>
          {models.length === 0 ? (
            <div className="empty-state">
              <h2>没有可用模型</h2>
              <p className="muted">当前没有 active ModelConfig。</p>
            </div>
          ) : null}

          <label>
            Model
            <select value={model} onChange={(event) => setModel(event.target.value)} disabled={models.length === 0 || sending}>
              {models.map((option) => (
                <option key={option.id} value={option.modelName}>
                  {option.providerName} / {option.displayName ?? option.modelName}
                </option>
              ))}
            </select>
          </label>

          <label>
            Messages
            <textarea
              className="chat-editor"
              value={messagesText}
              onChange={(event) => setMessagesText(event.target.value)}
              spellCheck={false}
              disabled={sending}
            />
          </label>

          <label className="checkbox-row">
            <input type="checkbox" checked={stream} onChange={(event) => setStream(event.target.checked)} disabled={sending} />
            Stream
          </label>

          {disabledReason ? <p className="form-error">{disabledReason}</p> : null}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" disabled={!canSend}>
            {sending ? "发送中" : "发送"}
          </button>
        </form>
      </section>

      <aside className="section">
        <section className="section-band">
          <h2>Dispatch</h2>
          <div className="kv-grid single-column">
            <div className="kv">
              <small>Mode</small>
              <strong>{stream ? "stream" : "non-stream"}</strong>
            </div>
            <div className="kv">
              <small>Gateway key</small>
              <strong>{hasChatApiKey ? "configured" : "missing"}</strong>
            </div>
            <div className="kv">
              <small>Trace target</small>
              <strong>predeclared Run ID</strong>
            </div>
          </div>
        </section>
      </aside>
    </div>
  );
}
