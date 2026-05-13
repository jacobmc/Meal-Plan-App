import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  // Sentry's browser SDK tunnels events through this rewrite (configured via
  // `tunnelRoute` in next.config.ts). Must bypass auth or client errors never
  // reach Sentry in production.
  "/monitoring(.*)",
  // Clerk delivers webhooks server-to-server; no Clerk session is present.
  // Authentication of the request is handled inside the route via Svix
  // signature verification.
  "/api/clerk/webhooks",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|.*\\..*).*)",
    "/(api|trpc)(.*)",
  ],
};
