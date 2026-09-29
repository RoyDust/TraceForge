"use client";
export default function GlobalError() {
  return <html lang="zh-CN"><body><main role="alert"><h1>控制台暂不可用</h1><p>请检查服务配置后重试。</p><button onClick={() => window.location.reload()}>重试</button></main></body></html>;
}
