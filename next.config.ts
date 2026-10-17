import type { NextConfig } from "next";

const API_UPSTREAM = process.env.API_UPSTREAM_URL || "http://178.104.100.35";

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    // Browser stays on HTTPS (Vercel); server proxies to Hetzner HTTP API (no mixed content).
    return [
      {
        source: "/backend/:path*",
        destination: `${API_UPSTREAM.replace(/\/$/, "")}/:path*`,
      },
    ];
  },
};

export default nextConfig;
