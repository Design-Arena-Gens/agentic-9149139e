import withPWA from "next-pwa";
import runtimeCaching from "next-pwa/cache.js";

const withPWAMiddleware = withPWA({
  dest: "public",
  register: true,
  skipWaiting: true,
  runtimeCaching,
  disable: process.env.NODE_ENV === "development",
  buildExcludes: [/middleware-manifest\.json$/],
  customWorkerDir: "worker",
});

const nextConfig = withPWAMiddleware({
  reactStrictMode: true,
  typedRoutes: true,
  turbopack: {},
  webpack: (config) => {
    config.resolve.fallback = {
      ...(config.resolve.fallback ?? {}),
      fs: false,
      path: false,
      os: false,
    };
    return config;
  },
});

export default nextConfig;
