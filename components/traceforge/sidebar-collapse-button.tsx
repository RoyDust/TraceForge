"use client";

import { useEffect, useState } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "traceforge.sidebar.collapsed";

function applySidebarState(collapsed: boolean) {
  const shell = document.querySelector<HTMLElement>(".console-shell");
  if (shell) shell.dataset.sidebarCollapsed = String(collapsed);
}

export function SidebarCollapseButton() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) === "true";
    setCollapsed(stored);
    applySidebarState(stored);
  }, []);

  function toggleSidebar() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(STORAGE_KEY, String(next));
      applySidebarState(next);
      return next;
    });
  }

  const label = collapsed ? "展开侧边栏" : "收起侧边栏";
  const Icon = collapsed ? ChevronsRight : ChevronsLeft;

  return (
    <Button
      className="console-collapse"
      variant="ghost"
      size="sm"
      type="button"
      aria-label={label}
      aria-expanded={!collapsed}
      title={label}
      onClick={toggleSidebar}
    >
      <Icon aria-hidden="true" />
      <span className="console-collapse-label">{collapsed ? "展开" : "收起"}</span>
    </Button>
  );
}
