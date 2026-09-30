import type { ReactNode } from "react";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });

export const metadata = {
  title: "TraceForge Console",
  robots: { index: false, follow: false },
  description: "AI 网关与 Agent 可观测平台 · 控制面",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="zh-CN"
      className={cn("font-sans", geist.variable)}
      suppressHydrationWarning
    >
      <body>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
