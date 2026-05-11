import { vi } from "vitest";

type ClerkAuthResult = { userId: string | null };

let currentClerkUserId: string | null = null;

export function setMockClerkUser(clerkUserId: string | null) {
  currentClerkUserId = clerkUserId;
}

vi.mock("@clerk/nextjs/server", () => ({
  auth: async (): Promise<ClerkAuthResult> => ({ userId: currentClerkUserId }),
}));
