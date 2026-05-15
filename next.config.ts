import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "192.168.100.198",
    "localhost",
  ],
};

export default nextConfig;