"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function TraceAutoRefresh({
  intervalMs = 1200,
  deadline,
}: {
  intervalMs?: number;
  deadline: number;
}) {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (Date.now() >= deadline) {
        setTimedOut(true);
        window.clearInterval(timer);
        return;
      }
      router.refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, router, deadline]);

  if (timedOut) {
    return (
      <p className="form-error" role="alert">
        未确认派发或运行尚未完成，已停止自动等待。请先核对运行 ID，避免重复发送付费请求。
      </p>
    );
  }

  return <p className="muted live-refresh">自动刷新中，等待追踪运行进入终态。</p>;
}
