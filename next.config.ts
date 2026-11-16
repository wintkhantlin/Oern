import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // REACT_COMPILER=off lets e2e runs A/B-test compiler interference.
  reactCompiler: process.env.REACT_COMPILER !== "off",
  // e2e tests run a second dev server on port 3100 while `next dev` may
  // already be running; each server needs its own lockfile, which lives in
  // the dist dir.
  // The OSM routing graph is read from disk at runtime, so ship it with the
  // dispatch functions.
  outputFileTracingIncludes: {
    "/api/dispatch/plan": ["./data/generated/yangon-road-graph.json"],
    "/api/dispatch/sources": ["./data/generated/yangon-road-graph.json"],
  },
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async redirects() {
    return [
      {
        source: "/",
        destination: "/welcome",
        permanent: false,
      },
      {
        source: "/manager",
        destination: "/manager/home",
        permanent: false,
      },
      {
        source: "/manager/insights",
        destination: "/manager/vehicles",
        permanent: false,
      },
      {
        source: "/rider",
        destination: "/rider/jobs",
        permanent: false,
      },
      {
        source: "/rider/cod",
        destination: "/rider/route",
        permanent: false,
      },
      {
        source: "/rider/deliveries",
        destination: "/rider/route",
        permanent: false,
      },
      {
        source: "/rider/profile",
        destination: "/rider/route",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
