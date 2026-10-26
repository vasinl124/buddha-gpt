/** The address the limits count against. Behind a proxy, TRUST_PROXY makes req.ip the client's
 * (app.ts). Behind an edge that sets a header to the client's address, and overwrites any a client
 * sends, CLIENT_IP_HEADER names it: Railway's x-real-ip stays the visitor's even when Cloudflare
 * proxies the domain, where X-Forwarded-For starts with Cloudflare's address. */
export function clientAddress(req: { ip?: string; get(name: string): string | undefined }): string {
  const header = process.env.CLIENT_IP_HEADER;
  return (header && req.get(header)?.trim()) || req.ip || "";
}

// Counts what each key, usually an address, did in a sliding window: the sign-in and chat limits.
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
