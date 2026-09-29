"use client";
export default function AppError() {
  return <main className="error-state" role="alert"><h1>控制台暂不可用</h1><p>请检查数据库与管理员环境配置后重试。</p><button onClick={() => window.location.reload()}>重试</button></main>;
}
