import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // workspace packages ship TypeScript source, so Next compiles them
  transpilePackages: ["@buddha-gpt/shared"],
  cacheComponents: true,
  partialPrefetching: true,
  // Hosted, the page reaches the agent under this app's own origin, at /agent, so the session cookie
  // is first-party: on Railway each service's domain is a site of its own. Built with AGENT_URL (the
  // agent's private address) and NEXT_PUBLIC_API_URL=/agent; locally the page calls :7891 directly.
  async rewrites() {
    const agent = process.env.AGENT_URL;
    return agent ? [{ source: "/agent/:path*", destination: `${agent}/:path*` }] : [];
  },
  experimental: { proxyTimeout: 120_000 }, // a reply can be quiet a while before its first words
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
