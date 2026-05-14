import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import "@/../tests/helpers/auth";
import "@/../tests/setup";
import { db } from "@/lib/db/client";
import { families, users, familyUsers, profiles, meals, scheduleEntries } from "@/lib/db/schema";
import { setMockClerkUser } from "@/../tests/helpers/auth";
import { resetDb } from "@/../tests/helpers/db";
import { POST } from "@/app/api/schedule/entries/route";
import { PATCH, DELETE } from "@/app/api/schedule/entries/[id]/route";

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

function patch(body: unknown) {
  return new Request("http://test/api/schedule/entries/_id_", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function del() {
  return new Request("http://test/api/schedule/entries/_id_", { method: "DELETE" });
}

async function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/schedule/entries/[id]", () => {
  beforeEach(async () => { await resetDb(); setMockClerkUser(null); });

  it("swaps meal → eat-out atomically", async () => {
    const { family, user, meal } = await seed();
    const [entry] = await db
      .insert(scheduleEntries)
      .values({
        familyId: family.id, date: "2026-05-11", slot: "lunch",
        mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
      })
      .returning();
    const res = await PATCH(patch({ mealId: null, eatingOut: true, eatingOutCost: 8 }), await ctx(entry!.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry.mealId).toBeNull();
    expect(body.entry.eatingOut).toBe(true);
    expect(body.entry.eatingOutCost).toBe(8);
  });

  it("swaps eat-out → meal atomically clears cost+label", async () => {
    const { family, user, meal } = await seed();
    const [entry] = await db
      .insert(scheduleEntries)
      .values({
        familyId: family.id, date: "2026-05-11", slot: "lunch",
        eatingOut: true, eatingOutCost: "5.00", eatingOutLabel: "x",
        createdByUserId: user.id, updatedByUserId: user.id,
      })
      .returning();
    const res = await PATCH(patch({ mealId: meal.id, eatingOut: false }), await ctx(entry!.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry.mealId).toBe(meal.id);
    expect(body.entry.eatingOut).toBe(false);
    expect(body.entry.eatingOutCost).toBeNull();
    expect(body.entry.eatingOutLabel).toBeNull();
  });

  it("notes-only update", async () => {
    const { family, user, meal } = await seed();
    const [entry] = await db
      .insert(scheduleEntries)
      .values({
        familyId: family.id, date: "2026-05-11", slot: "dinner",
        mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
      })
      .returning();
    const res = await PATCH(patch({ notes: "Prep ahead" }), await ctx(entry!.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry.notes).toBe("Prep ahead");
    expect(body.entry.mealId).toBe(meal.id);
  });

  it("404 on cross-family entry", async () => {
    const { user, meal } = await seed();
    const [other] = await db.insert(families).values({ name: "Other", weekStartsOn: 1 }).returning();
    const [entry] = await db
      .insert(scheduleEntries)
      .values({
        familyId: other!.id, date: "2026-05-11", slot: "dinner",
        mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
      })
      .returning();
    const res = await PATCH(patch({ notes: "x" }), await ctx(entry!.id));
    expect(res.status).toBe(404);
  });

  it("400 when payload sets both mealId and eatingOut=true", async () => {
    const { family, user, meal } = await seed();
    const [entry] = await db
      .insert(scheduleEntries)
      .values({
        familyId: family.id, date: "2026-05-11", slot: "dinner",
        mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
      })
      .returning();
    const res = await PATCH(patch({ mealId: meal.id, eatingOut: true }), await ctx(entry!.id));
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/schedule/entries/[id]", () => {
  beforeEach(async () => { await resetDb(); setMockClerkUser(null); });

  it("deleting an override returns the default's resolved state", async () => {
    const { family, user, profile, meal } = await seed();
    const [meal2] = await db.insert(meals).values({ familyId: family.id, name: "Salad", tags: [] }).returning();
    await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-05-11", slot: "dinner",
      mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
    });
    const [override] = await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-05-11", slot: "dinner",
      profileId: profile.id, mealId: meal2!.id,
      createdByUserId: user.id, updatedByUserId: user.id,
    }).returning();
    const res = await DELETE(del(), await ctx(override!.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    // After deleting the override, the resolved slot for that profile is the default
    expect(body.resolvedSlot.kind).toBe("meal");
    expect(body.resolvedSlot.source).toBe("default");
    expect(body.resolvedSlot.meal.name).toBe("Tacos");
  });

  it("deleting a default returns empty (overrides remain)", async () => {
    const { family, user, profile, meal } = await seed();
    const [meal2] = await db.insert(meals).values({ familyId: family.id, name: "Salad", tags: [] }).returning();
    const [def] = await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-05-11", slot: "dinner",
      mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
    }).returning();
    await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-05-11", slot: "dinner",
      profileId: profile.id, mealId: meal2!.id,
      createdByUserId: user.id, updatedByUserId: user.id,
    });
    const res = await DELETE(del(), await ctx(def!.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resolvedSlot).toEqual({ kind: "empty" });
    // Override is still there
    const remaining = await db
      .select()
      .from(scheduleEntries)
      .where(and(eq(scheduleEntries.familyId, family.id), eq(scheduleEntries.date, "2026-05-11")));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.profileId).toBe(profile.id);
  });

  it("404 on cross-family entry", async () => {
    const { user, meal } = await seed();
    const [other] = await db.insert(families).values({ name: "Other", weekStartsOn: 1 }).returning();
    const [entry] = await db.insert(scheduleEntries).values({
      familyId: other!.id, date: "2026-05-11", slot: "dinner",
      mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
    }).returning();
    const res = await DELETE(del(), await ctx(entry!.id));
    expect(res.status).toBe(404);
  });
});
