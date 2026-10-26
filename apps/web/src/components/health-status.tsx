"use client";

import type { AgentHealth, Status } from "@buddha-gpt/shared";
import { useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:7891";
const EVERY = 30_000; // a service can go down after the page loads
const DOT: Record<Status | "checking", string> = {
  up: "bg-success",
  down: "bg-destructive",
  unknown: "bg-muted-foreground/40",
  checking: "bg-muted-foreground/25",
};

// Asks the agent for /healthz, which also reports the Go core and Postgres. One dot in the top bar
// sums them up; hovering it, or focusing it, lists each.
export function HealthStatus() {
  const [health, setHealth] = useState<AgentHealth | "unreachable">();

  useEffect(() => {
    const check = () =>
      fetch(`${API}/healthz`)
        .then((r) => r.json() as Promise<AgentHealth>)
        .then(setHealth, () => setHealth("unreachable"));
    check();
    const timer = setInterval(check, EVERY);
    return () => clearInterval(timer);
  }, []);

  const services: [string, Status | "checking"][] = !health
    ? [["Agent", "checking"], ["Core", "checking"], ["Database", "checking"]]
    : health === "unreachable"
      ? [["Agent", "down"], ["Core", "unknown"], ["Database", "unknown"]]
      : [["Agent", "up"], ["Core", health.core], ["Database", health.db]];
  // the first one that isn't up: the agent comes first, since without it the others are unknown
  const [name, status] = services.find(([, s]) => s !== "up") ?? ["", "up"];
  const summary = !health ? "Checking services…" : status === "up" ? "All services up" : `${name} ${status}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={summary}
          className="grid size-8 cursor-default place-items-center rounded-md outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span aria-hidden className={`size-2 rounded-full transition-colors duration-300 ${DOT[status]}`} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" sideOffset={4} className="flex-col items-start gap-1">
        {services.map(([service, s]) => (
          <span key={service} className="flex items-center gap-1.5">
            <span aria-hidden className={`size-1.5 rounded-full ${DOT[s]}`} />
            {service} {s}
          </span>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}
