import { SquarePenIcon } from "lucide-react";
import { HealthStatus } from "@/components/health-status";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// The Dhamma wheel, the teaching set in motion: the app's mark, never an image of the Buddha (PRD §4).
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden className={className}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <path key={angle} d="M12 10V3" transform={`rotate(${angle} 12 12)`} />
      ))}
    </svg>
  );
}

// The bar over the chat: the name, the services' health and a fresh start. Without onNew (nothing to
// clear, or a reply on its way) the fresh start is disabled.
export function TopBar({ onNew }: { onNew?: () => void }) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between">
      <h1 className="flex items-center gap-2 text-sm font-medium">
        <Mark className="size-5 text-chart-3" />
        Buddha GPT
      </h1>
      <div className="flex items-center gap-0.5">
        <HealthStatus />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" disabled={!onNew} onClick={onNew} aria-label="New conversation">
              <SquarePenIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New conversation</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
