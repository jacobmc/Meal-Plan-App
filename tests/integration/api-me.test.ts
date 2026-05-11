import { describe, it, expect, beforeEach } from "vitest";
import "../helpers/auth";
import { setMockClerkUser } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { db } from "@/lib/db/client";
import { families, users, familyUsers, profiles } from "@/lib/db/schema";
import { GET } from "@/app/api/me/route";

beforeEach(async () => {
  await resetDb();
  setMockClerkUser(null);
});

function makeRequest() {
  return new Request("http://localhost/api/me");
}

describe("GET /api/me", () => {
  it("returns 401 when no session", async () => {
    setMockClerkUser(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns user, family, and profiles for an authenticated member", async () => {
    const [family] = await db
      .insert(families)
      .values({ name: "Test Family" })
      .returning();
    const [user] = await db
      .insert(users)
      .values({ clerkUserId: "user_me_test", email: "me@test.com", displayName: "Me" })
      .returning();
    await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });
    await db.insert(profiles).values([
      { familyId: family!.id, displayName: "Me", color: "#ff0000", sortOrder: 0 },
      { familyId: family!.id, displayName: "Spouse", color: "#00ff00", sortOrder: 1 },
    ]);

    setMockClerkUser("user_me_test");
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.id).toBe(user!.id);
    expect(body.family.id).toBe(family!.id);
    expect(body.profiles).toHaveLength(2);
    expect(body.profiles[0].displayName).toBe("Me");
    expect(body.profiles[1].displayName).toBe("Spouse");
  });
});
