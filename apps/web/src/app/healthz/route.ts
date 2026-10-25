// Liveness for the web app. It reads no runtime data, so Next prerenders it at build time.
export function GET() {
  return Response.json({ ok: true });
}
