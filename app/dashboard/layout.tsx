import type { ReactNode } from "react";
import { ConsoleShell } from "@/app/console-shell";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <ConsoleShell>{children}</ConsoleShell>;
}
