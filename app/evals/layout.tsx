import type { ReactNode } from "react";
import { ConsoleShell } from "../console-shell";

export default function EvalsLayout({ children }: { children: ReactNode }) {
  return <ConsoleShell>{children}</ConsoleShell>;
}
