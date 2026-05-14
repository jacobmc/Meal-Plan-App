import { describe, it, expect, beforeEach } from "vitest";
import "@/../tests/helpers/auth";
import "@/../tests/setup";
import { db } from "@/lib/db/client";
import { families, users, familyUsers, profiles, meals, scheduleEntries } from "@/lib/db/schema";
import { setMockClerkUser } from "@/../tests/helpers/auth";
import { resetDb } from "@/../tests/helpers/db";
import { POST } from "@/app/api/schedule/entries/route";

async function seed() {
  const [family] = await db.insert(families).values({ name: "T", weekStartsOn: 1 }).returning();
  const [user] = await db.insert(users).values({ clerkUserId: "clerk_e", email: "e@test" }).returning();
  await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });
  const [profile] = await db.insert(profiles).values({ familyId: family!.id, displayName: "Sam" }).returning();
  const [meal] = await db.insert(meals).values({ familyId: family!.id, name: "Tacos", tags: [] }).returning();
  setMockClerkUser("clerk_e");
  return { family: family!, user: user!, profile: profile!, meal: meal! };
}

function post(body: unknown) {
  return new Request("http://test/api/schedule/entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/schedule/entries", () => {
  beforeEach(async () => { await resetDb(); setMockClerkUser(null); });

  it("401 when unauthenticated", async () => {
    const res = await POST(post({ date: "2026-05-11", slot: "dinner", mealId: "550e8400-e29b-41d4-a716-446655440000" }));
    expect(res.status).toBe(401);
  });

  it("creates a default meal row", async () => {
    const { meal } = await seed();
    const res = await POST(post({ date: "2026-05-11", slot: "dinner", mealId: meal.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry.profileId).toBeNull();
    expect(body.entry.mealId).toBe(meal.id);
    expect(body.resolvedSlot.kind).toBe("meal");
    expect(body.resolvedSlot.source).toBe("default");
  });

  it("creates an override row", async () => {
    const { profile, meal } = await seed();
    const res = await POST(post({
      date: "2026-05-11", slot: "dinner", profileId: profile.id, mealId: meal.id,
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry.profileId).toBe(profile.id);
    expect(body.resolvedSlot.source).toBe("override");
  });

  it("creates an eat-out row with cost + label", async () => {
    await seed();
    const res = await POST(post({
      date: "2026-05-11", slot: "lunch", eatingOut: true, eatingOutCost: 12.5, eatingOutLabel: "Chipotle",
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry.eatingOut).toBe(true);
    expect(body.entry.eatingOutCost).toBe(12.5);
    expect(body.resolvedSlot.kind).toBe("eat-out");
  });

  it("409 on conflict (default row already exists)", async () => {
    const { family, user, meal } = await seed();
    await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-05-11", slot: "dinner",
      mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
    });
    const res = await POST(post({ date: "2026-05-11", slot: "dinner", mealId: meal.id }));
    expect(res.status).toBe(409);
  });

  it("404 when mealId belongs to another family", async () => {
    await seed();
    const [other] = await db.insert(families).values({ name: "Other", weekStartsOn: 1 }).returning();
    const [otherMeal] = await db.insert(meals).values({ familyId: other!.id, name: "X", tags: [] }).returning();
    const res = await POST(post({ date: "2026-05-11", slot: "dinner", mealId: otherMeal!.id }));
    expect(res.status).toBe(404);
  });

  it("404 when profileId belongs to another family", async () => {
    const { meal } = await seed();
    const [other] = await db.insert(families).values({ name: "Other", weekStartsOn: 1 }).returning();
    const [otherProfile] = await db.insert(profiles).values({ familyId: other!.id, displayName: "X" }).returning();
    const res = await POST(post({
      date: "2026-05-11", slot: "dinner", profileId: otherProfile!.id, mealId: meal.id,
    }));
    expect(res.status).toBe(404);
  });

  it("400 when both mealId and eatingOut are set", async () => {
    const { meal } = await seed();
    const res = await POST(post({
      date: "2026-05-11", slot: "dinner", mealId: meal.id, eatingOut: true,
    }));
    expect(res.status).toBe(400);
  });

  it("400 when neither mealId nor eatingOut is set", async () => {
    await seed();
    const res = await POST(post({ date: "2026-05-11", slot: "dinner" }));
    expect(res.status).toBe(400);
  });

  it("persists notes", async () => {
    const { meal } = await seed();
    const res = await POST(post({
      date: "2026-05-11", slot: "dinner", mealId: meal.id, notes: "Prep ahead",
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry.notes).toBe("Prep ahead");
  });
});
