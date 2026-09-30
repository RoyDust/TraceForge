import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, LogOut, Search, Workflow } from "lucide-react";
import { logoutAction } from "@/app/actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  ConsoleBreadcrumb,
  ConsoleNav,
} from "@/components/traceforge/console-nav";
import { SidebarCollapseButton } from "@/components/traceforge/sidebar-collapse-button";
import { requireAdmin } from "@/lib/auth";
import { getProjects } from "@/lib/dal";
import { demoMode } from "@/lib/env";

export async function ConsoleShell({ children }: { children: ReactNode }) {
  const session = await requireAdmin();
  const projects = await getProjects();
  const initials = session.email.slice(0, 2).toUpperCase();
  return (
    <div className="console-shell">
      <aside className="sidebar">
        <Link
          className="brand"
          href="/dashboard"
          aria-label="TraceForge 治理总览"
        >
          <span className="brand-mark" aria-hidden="true">
            <Workflow size={20} />
          </span>
          <span className="brand-copy">
            <strong>TraceForge</strong>
            <small>AI 可观测工作台</small>
          </span>
        </Link>
        <ConsoleNav />
        <div className="sidebar-footer">
          <SidebarCollapseButton />
          <div className="sidebar-account">
            <Avatar size="sm">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div>
              <strong>管理员</strong>
              <small title={session.email}>{session.email}</small>
            </div>
          </div>
          <form action={logoutAction}>
            <Button
              className="link-button"
              variant="ghost"
              size="sm"
              type="submit"
            >
              <LogOut aria-hidden="true" />
              <span className="sidebar-logout-label">退出登录</span>
            </Button>
          </form>
        </div>
      </aside>
      <div className="console-main">
        <header className="console-topbar">
          <ConsoleBreadcrumb />
          <form
            className="console-search"
            action="/traces"
            method="get"
            role="search"
          >
            <NativeSelect
              name="projectId"
              defaultValue=""
              aria-label="搜索项目"
            >
              <NativeSelectOption value="">全部项目</NativeSelectOption>
              {projects.map((project) => (
                <NativeSelectOption key={project.id} value={project.id}>
                  {project.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Search aria-hidden="true" />
            <Input
              name="model"
              placeholder="搜索运行、模型、供应商…"
              aria-label="全局搜索"
            />
            <Button
              variant="ghost"
              size="icon-sm"
              type="submit"
              aria-label="搜索追踪"
            >
              <ArrowRight aria-hidden="true" />
            </Button>
          </form>
          <div className="console-topbar-actions">
            {demoMode() ? (
              <Badge variant="outline" data-testid="demo-mode">
                演示模式
              </Badge>
            ) : null}
            <a
              className="console-docs"
              aria-label="项目文档（新窗口）"
              href="https://github.com/RoyDust/TraceForge#readme"
              target="_blank"
              rel="noreferrer"
            >
              <BookOpen size={16} aria-hidden="true" />
              <span>文档</span>
            </a>
          </div>
        </header>
        <div className="console-content">{children}</div>
      </div>
    </div>
  );
}
