import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    proxyClientMaxBodySize: "520mb",
  },
};

export default nextConfig;
