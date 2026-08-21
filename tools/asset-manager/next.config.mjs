/** @type {import('next').NextConfig} */
const apiBase = process.env.ASSET_MANAGER_INTERNAL_API ?? "http://localhost:3300";

const nextConfig = {
  reactStrictMode: true,
  // Proxy API calls through the Next server so the browser only ever talks to
  // one origin (no CORS in the common path). Direct calls still work via CORS.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiBase}/api/:path*` },
      { source: "/v1/:path*", destination: `${apiBase}/v1/:path*` },
      { source: "/health", destination: `${apiBase}/health` },
    ];
  },
};

export default nextConfig;
