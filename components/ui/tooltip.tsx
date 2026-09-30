"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "@/lib/utils";

function TooltipProvider({
  delayDuration = 350,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider> & {
  delayDuration?: number;
}) {
  return <TooltipPrimitive.Provider delay={delayDuration} {...props} />;
}
function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root {...props} />;
}
function TooltipTrigger({
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger> & {
  asChild?: boolean;
}) {
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      {...props}
      render={
        asChild && React.isValidElement(children) ? children : props.render
      }
    >
      {asChild ? undefined : children}
    </TooltipPrimitive.Trigger>
  );
}
function TooltipContent({
  className,
  side = "top",
  align = "center",
  sideOffset = 8,
  children,
  ...props
}: Omit<React.ComponentProps<typeof TooltipPrimitive.Popup>, "className"> & {
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        className="z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "rounded-md bg-foreground px-3 py-2 text-xs text-background shadow-sm",
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
