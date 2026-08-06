import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    proxyClientMaxBodySize: "520mb",
  },
  async headers() {
    const privateStreamingHeaders = [
      { key: "Cache-Control", value: "private, no-store, max-age=0" },
      { key: "X-Accel-Buffering", value: "no" },
    ];

    return [
      {
        source: "/crate/:path*",
        headers: privateStreamingHeaders,
      },
      {
        source: "/api/:path*",
        headers: privateStreamingHeaders,
      },
    ];
  },
};

export default nextConfig;
