import { describe, it, expect, beforeEach } from "vitest";
import "@/../tests/setup";
import { db } from "@/lib/db/client";
import { families, users, familyUsers, profiles, meals, scheduleEntries } from "@/lib/db/schema";
import { resolveWeek } from "@/lib/schedule/resolve";
import { resetDb } from "@/../tests/helpers/db";
import { parseISODate } from "@/lib/schedule/week";

async function seedFamilyWithProfile() {
  const [family] = await db.insert(families).values({ name: "Test", weekStartsOn: 1 }).returning();
  const [user] = await db.insert(users).values({ clerkUserId: "clerk_t1", email: "t1@test" }).returning();
  await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });
  const [profile] = await db.insert(profiles).values({ familyId: family!.id, displayName: "Sam" }).returning();
  const [meal] = await db.insert(meals).values({ familyId: family!.id, name: "Tacos", tags: ["dinner"] }).returning();
  const [meal2] = await db.insert(meals).values({ familyId: family!.id, name: "Salad", tags: [] }).returning();
  return { family: family!, user: user!, profile: profile!, meal: meal!, meal2: meal2! };
}

describe("resolveWeek", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns all empty slots when there are no entries", async () => {
    const [family] = await db.insert(families).values({ name: "Empty", weekStartsOn: 1 }).returning();
    const week = await resolveWeek(family!.id, parseISODate("2026-05-11"), null);
    expect(week.weekStart).toBe("2026-05-11");
    expect(week.days).toHaveLength(7);
    expect(week.days[0]!.breakfast).toEqual({ kind: "empty" });
    expect(week.days[6]!.dinner).toEqual({ kind: "empty" });
    expect(week.overrideMap).toEqual({});
  });

  it("returns default rows on the family-default view", async () => {
    const { family, user, meal } = await seedFamilyWithProfile();
    await db.insert(scheduleEntries).values({
      familyId: family.id,
      date: "2026-05-11",
      slot: "dinner",
      mealId: meal.id,
      createdByUserId: user.id,
      updatedByUserId: user.id,
    });
    const week = await resolveWeek(family.id, parseISODate("2026-05-11"), null);
    const slot = week.days[0]!.dinner;
    expect(slot.kind).toBe("meal");
    if (slot.kind === "meal") {
      expect(slot.source).toBe("default");
      expect(slot.meal.name).toBe("Tacos");
    }
  });

  it("returns the override when profileId is set and an override exists", async () => {
    const { family, user, profile, meal, meal2 } = await seedFamilyWithProfile();
    await db.insert(scheduleEntries).values([
      {
        familyId: family.id, date: "2026-05-11", slot: "dinner",
        mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
      },
      {
        familyId: family.id, date: "2026-05-11", slot: "dinner",
        profileId: profile.id, mealId: meal2.id, createdByUserId: user.id, updatedByUserId: user.id,
      },
    ]);
    const week = await resolveWeek(family.id, parseISODate("2026-05-11"), profile.id);
    const slot = week.days[0]!.dinner;
    expect(slot.kind).toBe("meal");
    if (slot.kind === "meal") {
      expect(slot.source).toBe("override");
      expect(slot.meal.name).toBe("Salad");
    }
  });

  it("falls back to default when profileId is set but no override exists", async () => {
    const { family, user, profile, meal } = await seedFamilyWithProfile();
    await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-05-11", slot: "dinner",
      mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
    });
    const week = await resolveWeek(family.id, parseISODate("2026-05-11"), profile.id);
    const slot = week.days[0]!.dinner;
    expect(slot.kind).toBe("meal");
    if (slot.kind === "meal") expect(slot.source).toBe("default");
  });

  it("populates overrideMap on the default view", async () => {
    const { family, user, profile, meal, meal2 } = await seedFamilyWithProfile();
    await db.insert(scheduleEntries).values([
      {
        familyId: family.id, date: "2026-05-11", slot: "dinner",
        mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
      },
      {
        familyId: family.id, date: "2026-05-11", slot: "dinner",
        profileId: profile.id, mealId: meal2.id, createdByUserId: user.id, updatedByUserId: user.id,
      },
    ]);
    const week = await resolveWeek(family.id, parseISODate("2026-05-11"), null);
    expect(week.overrideMap["2026-05-11"]).toEqual(["dinner"]);
  });

  it("renders an eating-out entry as kind=eat-out", async () => {
    const { family, user } = await seedFamilyWithProfile();
    await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-05-11", slot: "lunch",
      eatingOut: true, eatingOutCost: "12.50", eatingOutLabel: "Chipotle",
      createdByUserId: user.id, updatedByUserId: user.id,
    });
    const week = await resolveWeek(family.id, parseISODate("2026-05-11"), null);
    const slot = week.days[0]!.lunch;
    expect(slot.kind).toBe("eat-out");
    if (slot.kind === "eat-out") {
      expect(slot.entry.eatingOutCost).toBe(12.5);
      expect(slot.entry.eatingOutLabel).toBe("Chipotle");
    }
  });

  it("renders an orphan entry (meal_id null, eating_out false) as empty", async () => {
    const { family, user } = await seedFamilyWithProfile();
    // Insert directly via raw values to simulate a meal that was later deleted
    await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-05-11", slot: "breakfast",
      mealId: null, eatingOut: false,
      createdByUserId: user.id, updatedByUserId: user.id,
    });
    const week = await resolveWeek(family.id, parseISODate("2026-05-11"), null);
    expect(week.days[0]!.breakfast).toEqual({ kind: "empty" });
  });

  it("filters by family — does not see another family's rows", async () => {
    const { family: famA, user: userA, meal: mealA } = await seedFamilyWithProfile();
    const [famB] = await db.insert(families).values({ name: "Other", weekStartsOn: 1 }).returning();
    await db.insert(scheduleEntries).values({
      familyId: famB!.id, date: "2026-05-11", slot: "dinner",
      mealId: mealA.id, // cross-family, intentionally invalid setup for the test
      createdByUserId: userA.id, updatedByUserId: userA.id,
    });
    const week = await resolveWeek(famA.id, parseISODate("2026-05-11"), null);
    expect(week.days[0]!.dinner).toEqual({ kind: "empty" });
  });
});
