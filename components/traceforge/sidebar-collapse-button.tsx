"use client";

import { useEffect, useSyncExternalStore } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "traceforge.sidebar.collapsed";
const CHANGE_EVENT = "traceforge:sidebar-change";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function getSnapshot() {
  return window.localStorage.getItem(STORAGE_KEY) === "true";
}

function getServerSnapshot() {
  return false;
}

function applySidebarState(collapsed: boolean) {
  const shell = document.querySelector<HTMLElement>(".console-shell");
  if (shell) shell.dataset.sidebarCollapsed = String(collapsed);
}

export function SidebarCollapseButton() {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    applySidebarState(collapsed);
  }, [collapsed]);

  function toggleSidebar() {
    const next = !collapsed;
    window.localStorage.setItem(STORAGE_KEY, String(next));
    window.dispatchEvent(new Event(CHANGE_EVENT));
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
