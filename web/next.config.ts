import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native module: must stay a plain Node require, never bundled.
  serverExternalPackages: ["@duckdb/node-api"],
  poweredByHeader: false,
  // Templates are read from disk at runtime; make sure they ship with every server function.
  outputFileTracingIncludes: { "/**": ["./templates/**/*"] },
  // Logo uploads (≤ 1 MB) go through server actions.
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  // The showcase and the platform panel now live on the home page; keep old links working.
  async redirects() {
    return [
      { source: "/vitrine", destination: "/#vitrine", permanent: false },
      { source: "/plataforma", destination: "/", permanent: false },
      { source: "/plataforma/catalogo", destination: "/#vitrine", permanent: false },
    ];
  },
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
