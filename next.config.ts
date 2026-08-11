import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  ...(isGitHubPages
    ? {
        assetPrefix: "/Retirement-Portfolio-Protection",
      }
    : {}),
};

export default nextConfig;
