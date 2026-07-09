"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function TraceAutoRefresh({
  intervalMs = 1200,
  timeoutMs,
}: {
  intervalMs?: number;
  timeoutMs?: number;
}) {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (timeoutMs && Date.now() - startedAt >= timeoutMs) {
        setTimedOut(true);
        window.clearInterval(timer);
        return;
      }
      router.refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, router, timeoutMs]);

  if (timedOut) {
    return (
      <p className="form-error" role="alert">
        网关未接受请求或后台派发失败，请回到对话调试台重新发送。
      </p>
    );
  }

  return <p className="muted live-refresh">自动刷新中，等待追踪运行进入终态。</p>;
}
