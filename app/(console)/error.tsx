"use client";
export default function ConsoleError() {
  return <section className="error-state" role="alert"><h1>读取失败</h1><p>无法读取控制台数据。请检查数据库连接和配置后重试。</p><button onClick={() => window.location.reload()}>重试</button></section>;
}
