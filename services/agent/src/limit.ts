// Counts what each key, usually an address, did in a sliding window: the sign-in and chat limits.
// Behind a proxy, TRUST_PROXY makes req.ip the client's address (app.ts).
// ponytail: in this process's memory; a shared store if the agent runs as several instances
export function counter(windowMs: number) {
  const seen = new Map<string, number[]>();
  const recent = (key: string, now: number) => (seen.get(key) ?? []).filter((t) => now - t < windowMs);
  return {
    /** How many times key was counted inside the window. */
    used: (key: string) => recent(key, Date.now()).length,
    count(key: string) {
      const now = Date.now();
      seen.set(key, [...recent(key, now), now]);
      if (seen.size > 10_000) for (const [k, v] of seen) if (now - (v.at(-1) ?? 0) >= windowMs) seen.delete(k);
    },
  };
}
