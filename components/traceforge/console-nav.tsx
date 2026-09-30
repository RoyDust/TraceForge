"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  ClipboardCheck,
  FileText,
  ListTree,
  MessageCircle,
} from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "治理总览", icon: BarChart3 },
  { href: "/chat", label: "对话调试", icon: MessageCircle },
  { href: "/traces", label: "追踪运行", icon: ListTree },
  { href: "/prompts", label: "提示词", icon: FileText },
  { href: "/evals", label: "评测", icon: ClipboardCheck },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ConsoleNav() {
  const pathname = usePathname();

  return (
    <nav className="console-nav" aria-label="主导航">
      {NAV_ITEMS.map((item) => {
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
    </nav>
  );
}
