import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native module: must stay a plain Node require, never bundled.
  serverExternalPackages: ["@duckdb/node-api"],
  poweredByHeader: false,
  // Logo uploads (≤ 1 MB) go through server actions.
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
