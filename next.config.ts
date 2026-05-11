import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const isDev = process.env.NODE_ENV === "development";

const withPWA = withPWAInit({
  dest: "public",
  disable: isDev,
  register: true,
  workboxOptions: {
    runtimeCaching: [
      {
        urlPattern: /^\/api\/(me|profiles|grocery-list|week|meals).*/,
        handler: "StaleWhileRevalidate",
        options: { cacheName: "api-read", expiration: { maxAgeSeconds: 60 * 60 * 24 } },
      },
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

export default withPWA(nextConfig);
