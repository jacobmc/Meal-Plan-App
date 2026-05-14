import { describe, it, expect, beforeEach } from "vitest";
import "../helpers/auth";
import "../setup";
import { db } from "@/lib/db/client";
import { families, users, familyUsers, profiles, meals, scheduleEntries } from "@/lib/db/schema";
import { setMockClerkUser } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { POST } from "@/app/api/schedule/copy-week/route";

async function seed() {
  const [family] = await db.insert(families).values({ name: "T", weekStartsOn: 1 }).returning();
  const [user] = await db.insert(users).values({ clerkUserId: "clerk_cw_api", email: "cwa@test" }).returning();
  await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });
  const [meal] = await db.insert(meals).values({ familyId: family!.id, name: "Tacos", tags: [] }).returning();
  setMockClerkUser("clerk_cw_api");
  return { family: family!, user: user!, meal: meal! };
}

function post(body: unknown) {
  return new Request("http://test/api/schedule/copy-week", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/schedule/copy-week", () => {
  beforeEach(async () => {
    await resetDb();
    setMockClerkUser(null);
  });

  it("401 when unauthenticated", async () => {
    const res = await POST(post({ from: "2026-05-04", to: "2026-05-11" }));
    expect(res.status).toBe(401);
  });

  it("copies defaults and returns the target week", async () => {
    const { family, user, meal } = await seed();
    await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-05-04", slot: "dinner",
      mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
    });
    const res = await POST(post({ from: "2026-05-04", to: "2026-05-11" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.copied).toBe(1);
    expect(body.week.weekStart).toBe("2026-05-11");
    expect(body.week.days[0].dinner.kind).toBe("meal");
  });

  it("400 on invalid date format", async () => {
    await seed();
    const res = await POST(post({ from: "May 4", to: "2026-05-11" }));
    expect(res.status).toBe(400);
  });
});
