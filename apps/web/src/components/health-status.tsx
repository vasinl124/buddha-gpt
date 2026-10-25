"use client";

import type { AgentHealth, Status } from "@buddha-gpt/shared";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:7891";
const VARIANT = { up: "default", down: "destructive", unknown: "outline" } as const;

// Asks the agent for /healthz, which also reports the Go core and Postgres.
export function HealthStatus() {
  const [health, setHealth] = useState<AgentHealth | "unreachable">();

  useEffect(() => {
    fetch(`${API}/healthz`)
      .then((r) => r.json() as Promise<AgentHealth>)
      .then(setHealth, () => setHealth("unreachable"));
  }, []);

  if (!health) return <p className="text-sm text-muted-foreground">Checking services…</p>;

  const services: [string, Status][] =
    health === "unreachable"
      ? [["agent", "down"], ["core", "unknown"], ["db", "unknown"]]
      : [["agent", "up"], ["core", health.core], ["db", health.db]];

  return (
    <div className="flex gap-2">
      {services.map(([name, status]) => (
        <Badge key={name} variant={VARIANT[status]}>
          {name} {status}
        </Badge>
      ))}
    </div>
  );
}
