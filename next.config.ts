import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const isDev = process.env.NODE_ENV === "development";

const withPWA = withPWAInit({
  dest: "public",
  disable: isDev,
  register: true,
  workboxOptions: {
    runtimeCaching: [
      // Grocery check-off — queue offline PATCHes and replay on reconnect.
      {
        urlPattern: ({ url, sameOrigin, request }) =>
          sameOrigin &&
          request.method === "PATCH" &&
          /^\/api\/grocery\/lists\/[^/]+\/items\/[^/]+$/.test(url.pathname),
        handler: "NetworkOnly",
        method: "PATCH",
        options: {
          backgroundSync: {
            name: "grocery-checkoff-queue",
            options: { maxRetentionTime: 24 * 60 }, // minutes
          },
        },
      },
      // Grocery reads — aisle-critical
      {
        urlPattern: ({ url, sameOrigin }) =>
          sameOrigin && /^\/app\/grocery\/[^/]+$/.test(url.pathname),
        handler: "StaleWhileRevalidate",
        options: { cacheName: "grocery-pages", expiration: { maxAgeSeconds: 60 * 60 * 24 } },
      },
      {
        urlPattern: ({ url, sameOrigin }) =>
          sameOrigin && /^\/api\/grocery\/lists(\/[^/]+)?$/.test(url.pathname),
        handler: "StaleWhileRevalidate",
        options: { cacheName: "grocery-api", expiration: { maxAgeSeconds: 60 * 60 * 24 } },
      },
      // Calendar reads
      {
        urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/app/calendar"),
        handler: "StaleWhileRevalidate",
        options: { cacheName: "calendar-pages", expiration: { maxAgeSeconds: 60 * 60 * 24 } },
      },
      {
        urlPattern: ({ url, sameOrigin }) =>
          sameOrigin && url.pathname.startsWith("/api/schedule/week"),
        handler: "StaleWhileRevalidate",
        options: { cacheName: "schedule-api", expiration: { maxAgeSeconds: 60 * 60 * 24 } },
      },
      // Meal detail
      {
        urlPattern: ({ url, sameOrigin }) =>
          sameOrigin && /^\/app\/meals\/[^/]+$/.test(url.pathname),
        handler: "StaleWhileRevalidate",
        options: { cacheName: "meal-pages", expiration: { maxAgeSeconds: 60 * 60 * 24 } },
      },
      {
        urlPattern: ({ url, sameOrigin }) =>
          sameOrigin && /^\/api\/meals\/[^/]+$/.test(url.pathname),
        handler: "StaleWhileRevalidate",
        options: { cacheName: "meal-api", expiration: { maxAgeSeconds: 60 * 60 * 24 } },
      },
      // Me / profiles reads (retained from Phase 0)
      {
        urlPattern: ({ url, sameOrigin }) =>
          sameOrigin && /^\/api\/(me|profiles)/.test(url.pathname),
        handler: "StaleWhileRevalidate",
        options: { cacheName: "auth-api", expiration: { maxAgeSeconds: 60 * 60 * 24 } },
      },
      // Static images
      {
        urlPattern: /\.(?:png|jpg|jpeg|svg|webp|ico)$/,
        handler: "CacheFirst",
        options: { cacheName: "images", expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 } },
      },
    ],
  },
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default withSentryConfig(withPWA(nextConfig), {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "bluebisondigital",

  project: "meal-plan-app",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
