import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // workspace packages ship TypeScript source, so Next compiles them
  transpilePackages: ["@buddha-gpt/shared"],
  cacheComponents: true,
  partialPrefetching: true,
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
