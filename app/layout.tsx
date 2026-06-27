import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "TraceForge Console",
  description: "AI 网关与 Agent 可观测平台 · 控制面",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
