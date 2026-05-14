import { describe, it, expect, beforeEach } from "vitest";
import "../helpers/auth";
import { setMockClerkUser } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { db } from "@/lib/db/client";
import { families, users, familyUsers, profiles, meals, scheduleEntries } from "@/lib/db/schema";
import { GET } from "@/app/api/schedule/week/route";

async function seed() {
  const [family] = await db.insert(families).values({ name: "T", weekStartsOn: 1 }).returning();
  const [user] = await db.insert(users).values({ clerkUserId: "clerk_w", email: "w@test" }).returning();
  await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });
  const [profile] = await db.insert(profiles).values({ familyId: family!.id, displayName: "Sam" }).returning();
  const [meal] = await db.insert(meals).values({ familyId: family!.id, name: "Tacos", tags: [] }).returning();
  setMockClerkUser("clerk_w");
  return { family: family!, user: user!, profile: profile!, meal: meal! };
}

function req(url: string) {
  return new Request(url);
}

describe("GET /api/schedule/week", () => {
  beforeEach(async () => {
    await resetDb();
    setMockClerkUser(null);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await GET(req("http://test/api/schedule/week?week=2026-05-11"));
    expect(res.status).toBe(401);
  });

  it("returns a week aligned to the family's weekStartsOn", async () => {
    await seed();
    // Family week starts Monday. Pass Thursday — should align to Monday 2026-05-11
    const res = await GET(req("http://test/api/schedule/week?week=2026-05-14"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.weekStart).toBe("2026-05-11");
    expect(body.days).toHaveLength(7);
  });

  it("returns default-view resolution when profile is omitted", async () => {
    const { family, user, meal } = await seed();
    await db.insert(scheduleEntries).values({
      familyId: family.id,
      date: "2026-05-11",
      slot: "dinner",
      mealId: meal.id,
      createdByUserId: user.id,
      updatedByUserId: user.id,
    });
    const res = await GET(req("http://test/api/schedule/week?week=2026-05-11"));
    const body = await res.json();
    expect(body.days[0].dinner.kind).toBe("meal");
    expect(body.days[0].dinner.source).toBe("default");
  });

  it("returns per-profile resolution when profile=<id> is supplied", async () => {
    const { family, user, profile, meal } = await seed();
    const [meal2] = await db
      .insert(meals)
      .values({ familyId: family.id, name: "Salad", tags: [] })
      .returning();
    await db.insert(scheduleEntries).values([
      {
        familyId: family.id,
        date: "2026-05-11",
        slot: "dinner",
        mealId: meal.id,
        createdByUserId: user.id,
        updatedByUserId: user.id,
      },
      {
        familyId: family.id,
        date: "2026-05-11",
        slot: "dinner",
        profileId: profile.id,
        mealId: meal2!.id,
        createdByUserId: user.id,
        updatedByUserId: user.id,
      },
    ]);
    const res = await GET(req(`http://test/api/schedule/week?week=2026-05-11&profile=${profile.id}`));
    const body = await res.json();
    expect(body.days[0].dinner.source).toBe("override");
    expect(body.days[0].dinner.meal.name).toBe("Salad");
  });

  it("returns 400 when week is missing", async () => {
    await seed();
    const res = await GET(req("http://test/api/schedule/week"));
    expect(res.status).toBe(400);
  });
});
