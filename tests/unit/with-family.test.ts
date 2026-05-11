import { describe, it, expect, beforeEach } from "vitest";
import "../helpers/auth";
import { setMockClerkUser } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { db } from "@/lib/db/client";
import { families, users, familyUsers } from "@/lib/db/schema";
import { withFamily } from "@/lib/auth/with-family";
import { UnauthorizedError, ForbiddenError } from "@/lib/auth/errors";

beforeEach(async () => {
  await resetDb();
  setMockClerkUser(null);
});

describe("withFamily", () => {
  it("throws UnauthorizedError when no Clerk session", async () => {
    setMockClerkUser(null);
    await expect(withFamily()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws UnauthorizedError when Clerk user has no row in users table", async () => {
    setMockClerkUser("user_unknown");
    await expect(withFamily()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws ForbiddenError when user has no family membership", async () => {
    const [user] = await db
      .insert(users)
      .values({ clerkUserId: "user_no_family", email: "x@y.com" })
      .returning();
    setMockClerkUser("user_no_family");
    await expect(withFamily()).rejects.toBeInstanceOf(ForbiddenError);
    expect(user).toBeDefined();
  });

  it("returns userId and familyId for a member", async () => {
    const [family] = await db.insert(families).values({ name: "Test Family" }).returning();
    const [user] = await db
      .insert(users)
      .values({ clerkUserId: "user_member", email: "m@y.com" })
      .returning();
    await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });

    setMockClerkUser("user_member");
    const ctx = await withFamily();
    expect(ctx.userId).toBe(user!.id);
    expect(ctx.familyId).toBe(family!.id);
  });
});
