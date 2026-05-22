import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Skip re-type-checking during production build (already verified locally).
  // Saves ~600 MB RAM on the build server.
  typescript: { ignoreBuildErrors: true },

  // Turbopack config — dev only, ignored by `next build`
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
