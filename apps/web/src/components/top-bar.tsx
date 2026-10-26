import { SquarePenIcon } from "lucide-react";
import type { ReactNode } from "react";
import { HealthStatus } from "@/components/health-status";
import { Button } from "@/components/ui/button";
import { Sidebar, SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// The Dhamma wheel, the teaching set in motion, its eight spokes the eightfold path: the app's mark,
// never an image of the Buddha (PRD §4). The same wheel as docs/brand/mark.svg.
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden className={className}>
      <circle cx="12" cy="12" r="9.5" strokeWidth={1.4} />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <path key={angle} d="M12 8.25V2.5" strokeWidth={1.2} transform={`rotate(${angle} 12 12)`} />
      ))}
    </svg>
  );
}

// The page: the conversations in a sidebar (a drawer on a phone), then the bar across the top and the
// chat under it, which sets its own column. The loading page renders it too, with an empty sidebar,
// so nothing moves once the chat loads.
export function Frame({ sidebar, onNew, children }: { sidebar?: ReactNode; onNew?: () => void; children?: ReactNode }) {
  return (
    <SidebarProvider className="h-svh">
      {sidebar ?? <Sidebar />}
      <SidebarInset className="min-h-0">
        <TopBar onNew={onNew} />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}

// The bar over the chat: the conversations, the name, the services' health and a fresh start. Without
// onNew (nothing to clear, or a reply on its way) the fresh start is disabled.
function TopBar({ onNew }: { onNew?: () => void }) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-2 px-3 md:px-4">
      <div className="flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarTrigger />
          </TooltipTrigger>
          <TooltipContent>Conversations</TooltipContent>
        </Tooltip>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-[-0.045em]">
          <Mark className="size-6" />
          Buddha GPT
        </h1>
      </div>
      <div className="flex items-center gap-1.5">
        <HealthStatus />
        <Button
          variant="outline"
          size="lg"
          disabled={!onNew}
          onClick={onNew}
          aria-label="New conversation"
          className="gap-2.5 border-foreground bg-transparent px-3 hover:bg-hero"
        >
          <span className="hidden sm:inline">New conversation</span>
          <SquarePenIcon />
        </Button>
      </div>
    </header>
  );
}
