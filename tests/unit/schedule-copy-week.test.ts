import { describe, it, expect, beforeEach } from "vitest";
import "@/../tests/setup";
import { db } from "@/lib/db/client";
import { and, eq } from "drizzle-orm";
import { families, users, familyUsers, profiles, meals, scheduleEntries } from "@/lib/db/schema";
import { copyWeekPlan } from "@/lib/schedule/copy-week";
import { resetDb } from "@/../tests/helpers/db";

async function seed() {
  const [family] = await db.insert(families).values({ name: "Test", weekStartsOn: 1 }).returning();
  const [user] = await db.insert(users).values({ clerkUserId: "clerk_cw", email: "cw@test" }).returning();
  await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });
  const [profile] = await db.insert(profiles).values({ familyId: family!.id, displayName: "Sam" }).returning();
  const [meal] = await db.insert(meals).values({ familyId: family!.id, name: "Tacos", tags: [] }).returning();
  return { family: family!, user: user!, profile: profile!, meal: meal! };
}

describe("copyWeekPlan", () => {
  beforeEach(async () => { await resetDb(); });

  it("copies default rows by shifting the date forward 7 days", async () => {
    const { family, user, meal } = await seed();
    await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-05-04", slot: "dinner",
      mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
    });
    const result = await copyWeekPlan(family.id, "2026-05-04", "2026-05-11", user.id);
    expect(result.copied).toBe(1);
    const rows = await db
      .select()
      .from(scheduleEntries)
      .where(and(eq(scheduleEntries.familyId, family.id), eq(scheduleEntries.date, "2026-05-11")));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.mealId).toBe(meal.id);
  });

  it("does not copy override rows", async () => {
    const { family, user, profile, meal } = await seed();
    await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-05-04", slot: "dinner",
      profileId: profile.id, mealId: meal.id,
      createdByUserId: user.id, updatedByUserId: user.id,
    });
    const result = await copyWeekPlan(family.id, "2026-05-04", "2026-05-11", user.id);
    expect(result.copied).toBe(0);
  });

  it("skips collisions in the target week without overwriting", async () => {
    const { family, user, meal } = await seed();
    await db.insert(scheduleEntries).values([
      { familyId: family.id, date: "2026-05-04", slot: "dinner",
        mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id },
      // Pre-existing default in the target week
      { familyId: family.id, date: "2026-05-11", slot: "dinner",
        mealId: meal.id, notes: "preserve me",
        createdByUserId: user.id, updatedByUserId: user.id },
    ]);
    const result = await copyWeekPlan(family.id, "2026-05-04", "2026-05-11", user.id);
    expect(result.copied).toBe(0);
    const [target] = await db
      .select()
      .from(scheduleEntries)
      .where(and(eq(scheduleEntries.familyId, family.id), eq(scheduleEntries.date, "2026-05-11")));
    expect(target!.notes).toBe("preserve me");
  });

  it("only copies rows from the source week, not surrounding days", async () => {
    const { family, user, meal } = await seed();
    await db.insert(scheduleEntries).values([
      { familyId: family.id, date: "2026-05-03", slot: "dinner",  // day before source week
        mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id },
      { familyId: family.id, date: "2026-05-04", slot: "dinner",  // in source week
        mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id },
      { familyId: family.id, date: "2026-05-10", slot: "dinner",  // end of source week
        mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id },
      { familyId: family.id, date: "2026-05-11", slot: "dinner",  // already in target
        mealId: null, eatingOut: true, eatingOutCost: "5.00",
        createdByUserId: user.id, updatedByUserId: user.id },
    ]);
    const result = await copyWeekPlan(family.id, "2026-05-04", "2026-05-11", user.id);
    // 2 source rows (05-04 + 05-10), but 05-04 collides with the existing 05-11 row → 1 copied
    expect(result.copied).toBe(1);
  });

  it("scopes by family — does not copy other families' rows", async () => {
    const { family, user, meal } = await seed();
    const [other] = await db.insert(families).values({ name: "Other", weekStartsOn: 1 }).returning();
    await db.insert(scheduleEntries).values({
      familyId: other!.id, date: "2026-05-04", slot: "dinner",
      mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
    });
    const result = await copyWeekPlan(family.id, "2026-05-04", "2026-05-11", user.id);
    expect(result.copied).toBe(0);
  });
});
