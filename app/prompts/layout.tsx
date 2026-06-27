import type { ReactNode } from "react";
import { ConsoleShell } from "@/app/console-shell";

export default function PromptsLayout({ children }: { children: ReactNode }) {
  return <ConsoleShell>{children}</ConsoleShell>;
}
