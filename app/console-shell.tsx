import type { ReactNode } from "react";
import Link from "next/link";
import { logoutAction } from "@/app/actions";
import { requireAdmin } from "@/lib/auth";

export async function ConsoleShell({ children }: { children: ReactNode }) {
  const session = await requireAdmin();

  return (
    <div className="console-shell">
      <aside className="sidebar">
        <Link className="brand" href="/traces" aria-label="TraceForge traces">
          <span className="brand-mark">TF</span>
          <span>
            <strong>TraceForge</strong>
            <small>Console</small>
          </span>
        </Link>
        <nav className="nav-list" aria-label="主导航">
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/chat">Chat</Link>
          <Link href="/traces">TraceRuns</Link>
          <Link href="/prompts">Prompt</Link>
          <Link href="/evals">Eval</Link>
        </nav>
        <div className="sidebar-footer">
          <small>{session.email}</small>
          <form action={logoutAction}>
            <button className="link-button" type="submit">
              退出
            </button>
          </form>
        </div>
      </aside>
      <div className="console-content">{children}</div>
    </div>
  );
}
