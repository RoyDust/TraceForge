import type { ReactNode } from "react";
import Link from "next/link";
import {
  Bell,
  ChevronsLeft,
  Clock3,
  Command,
  LogOut,
  Search,
  ShieldCheck,
} from "lucide-react";
import { logoutAction } from "@/app/actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { ConsoleNav } from "@/components/traceforge/console-nav";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { consoleChromeViewModel } from "@/lib/ui-view-models";

export async function ConsoleShell({ children }: { children: ReactNode }) {
  const session = await requireAdmin();
  const projects = await prisma.project.findMany({ orderBy: { createdAt: "asc" } }).catch(() => []);
  const chrome = consoleChromeViewModel(projects);
  const initials = session.email.slice(0, 2).toUpperCase();

  return (
    <div className="console-shell">
      <aside className="sidebar">
        <Link className="brand" href="/traces" aria-label="TraceForge 追踪运行">
          <span className="brand-mark" aria-hidden="true">
            TF
          </span>
          <span>
            <strong>TraceForge</strong>
            <small>事故指挥台</small>
          </span>
        </Link>
        <ConsoleNav />
        <div className="sidebar-footer">
          <div className="sidebar-status">
            <ShieldCheck aria-hidden="true" />
            <span>网关已治理</span>
          </div>
          <Button asChild variant="ghost" size="sm" className="console-collapse">
            <span>
              <ChevronsLeft aria-hidden="true" />
              收起
            </span>
          </Button>
          <small>{session.email}</small>
          <form action={logoutAction}>
            <Button className="link-button" variant="ghost" size="sm" type="submit">
              <LogOut aria-hidden="true" />
              退出
            </Button>
          </form>
        </div>
      </aside>
      <div className="console-main">
        <header className="console-topbar">
          <div className="console-topbar-group">
            <NativeSelect defaultValue={chrome.projectOptions[0]?.id ?? "all"} aria-label="项目">
              <NativeSelectOption value="all">全部项目</NativeSelectOption>
              {chrome.projectOptions.map((project) => (
                <NativeSelectOption key={project.id} value={project.id}>
                  {project.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="console-search">
            <Search aria-hidden="true" />
            <Input placeholder="搜索追踪运行、调用跨度、提示词、模型..." aria-label="全局搜索" />
            <Badge variant="outline">
              <Command aria-hidden="true" />
              K
            </Badge>
          </div>
          <div className="console-topbar-actions">
            <Button variant="outline" size="sm">
              <Clock3 aria-hidden="true" />
              近 24 小时
            </Button>
            <Badge className="console-live" data-source={chrome.liveIngest.source} data-freshness={chrome.freshness.value}>
              <span aria-hidden="true" />
              实时接入
              <strong>{chrome.liveIngest.value}</strong>
            </Badge>
            <Badge variant="outline" data-source={chrome.environment.source}>
              {chrome.environment.value}
            </Badge>
            <Button variant="ghost" size="icon-sm" aria-label="通知">
              <Bell aria-hidden="true" />
            </Button>
            <Separator orientation="vertical" className="console-topbar-separator" />
            <Avatar size="sm">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          </div>
        </header>
        <div className="console-content">{children}</div>
      </div>
    </div>
  );
}
