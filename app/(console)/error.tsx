"use client";
export default function ConsoleError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section className="error-state" role="alert"><h1>读取失败</h1><p>无法读取控制台数据。请检查数据库连接和配置后重试。</p><button onClick={reset}>重试</button></section>;
}
