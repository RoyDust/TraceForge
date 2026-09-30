"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  ClipboardCheck,
  FileText,
  ListTree,
  MessageCircle,
  ChevronRight,
  Layers3,
} from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "治理总览", icon: BarChart3, group: "监控" },
  { href: "/traces", label: "追踪运行", icon: ListTree, group: "监控" },
  { href: "/chat", label: "对话调试", icon: MessageCircle, group: "开发" },
  { href: "/prompts", label: "提示词", icon: FileText, group: "开发" },
  { href: "/evals", label: "评测", icon: ClipboardCheck, group: "开发" },
];

export function ConsoleBreadcrumb() {
  const pathname = usePathname();
  const current = NAV_ITEMS.find((item) => isActive(pathname, item.href));
  return (
    <nav className="console-workspace" aria-label="当前位置">
      <Layers3 size={16} aria-hidden="true" />
      <span>{current?.group ?? "工作空间"}</span>
      <ChevronRight size={13} aria-hidden="true" />
      <Link
        href={current?.href ?? "/dashboard"}
        aria-current={pathname === current?.href ? "page" : undefined}
      >
        {current?.label ?? "TraceForge"}
      </Link>
      {current && pathname !== current.href ? (
        <>
          <ChevronRight size={13} aria-hidden="true" />
          <strong>详情</strong>
        </>
      ) : null}
    </nav>
  );
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ConsoleNav() {
  const pathname = usePathname();

  return (
    <nav className="console-nav" aria-label="主导航">
      {["监控", "开发"].map((group) => (
        <div className="console-nav-group" key={group}>
          <div className="sidebar-section-label">{group}</div>
          {NAV_ITEMS.filter((item) => item.group === group).map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);

            return (
              <Tooltip key={item.href}>
                <TooltipTrigger
                  render={
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                    />
                  }
                  className={cn("console-nav-link", active && "is-active")}
                >
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                </TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
