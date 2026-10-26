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

// The page: the conversations in a sidebar (a drawer on a phone), then the chat in a column with its
// bar. The loading page renders it too, with an empty sidebar, so nothing moves once the chat loads.
export function Frame({ sidebar, onNew, children }: { sidebar?: ReactNode; onNew?: () => void; children?: ReactNode }) {
  return (
    <SidebarProvider className="h-svh">
      {sidebar ?? <Sidebar />}
      <SidebarInset className="min-h-0">
        <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col px-4 pb-3">
          <TopBar onNew={onNew} />
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

// The bar over the chat: the conversations, the name, the services' health and a fresh start. Without
// onNew (nothing to clear, or a reply on its way) the fresh start is disabled.
function TopBar({ onNew }: { onNew?: () => void }) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between">
      <div className="flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarTrigger className="-ml-2" />
          </TooltipTrigger>
          <TooltipContent>Conversations</TooltipContent>
        </Tooltip>
        <h1 className="flex items-center gap-2 font-serif text-[0.95rem] font-medium">
          <Mark className="size-5 text-chart-3" />
          Buddha GPT
        </h1>
      </div>
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
