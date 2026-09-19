// Controls shared by the panes.
import type React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

/** A square gold button holding an icon, like the run and step buttons */
export function IconButton({ className, ...props }: React.ComponentProps<typeof Button>) {
  return <Button size="icon" className={cn("rounded-md font-bold disabled:bg-stone-500 disabled:opacity-60", className)} {...props} />;
}

/** A number in an outlined, rounded box, as in the step and solution counts */
export function NumberBadge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={cn("inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-md border text-sm font-bold tabular-nums", className)}
    >
      {children}
    </span>
  );
}
