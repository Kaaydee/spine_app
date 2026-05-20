import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "192.168.100.198",
    "192.168.15.10",
    "localhost",
  ],
};

export default nextConfig;