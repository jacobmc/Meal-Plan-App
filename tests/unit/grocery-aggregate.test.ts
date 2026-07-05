import { describe, it, expect, beforeEach } from "vitest";
import "@/../tests/setup";
import { db } from "@/lib/db/client";
import {
  families,
  users,
  familyUsers,
  profiles,
  ingredients,
  meals,
  mealIngredients,
  scheduleEntries,
} from "@/lib/db/schema";
import { generateDerivedItems } from "@/lib/grocery/aggregate";
import { resetDb } from "@/../tests/helpers/db";

async function seed() {
  const [family] = await db.insert(families).values({ name: "Test", weekStartsOn: 1 }).returning();
  const [user] = await db.insert(users).values({ clerkUserId: "clerk_g1", email: "g1@t" }).returning();
  await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });
  const [profile] = await db.insert(profiles).values({ familyId: family!.id, displayName: "Sam" }).returning();
  return { family: family!, user: user!, profile: profile! };
}

async function makeIngredient(familyId: string, name: string, category: string, defaultUnit: string | null = null) {
  const [row] = await db.insert(ingredients).values({ familyId, name, category, defaultUnit }).returning();
  return row!;
}

async function makeMeal(familyId: string, name: string) {
  const [row] = await db.insert(meals).values({ familyId, name }).returning();
  return row!;
}

describe("generateDerivedItems", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns [] when the range is empty", async () => {
    const { family } = await seed();
    const items = await generateDerivedItems(family.id, "2026-07-06", "2026-07-12");
    expect(items).toEqual([]);
  });

  it("skips eating-out entries", async () => {
    const { family, user } = await seed();
    await db.insert(scheduleEntries).values({
      familyId: family.id,
      date: "2026-07-06",
      slot: "dinner",
      eatingOut: true,
      eatingOutCost: "12.50",
      createdByUserId: user.id,
      updatedByUserId: user.id,
    });
    const items = await generateDerivedItems(family.id, "2026-07-06", "2026-07-12");
    expect(items).toEqual([]);
  });

  it("aggregates same-ingredient same-unit rows across meals", async () => {
    const { family, user } = await seed();
    const onion = await makeIngredient(family.id, "Onion", "produce");
    const tacos = await makeMeal(family.id, "Tacos");
    const chili = await makeMeal(family.id, "Chili");
    await db.insert(mealIngredients).values([
      { mealId: tacos.id, ingredientId: onion.id, quantity: "2", unit: "cup" },
      { mealId: chili.id, ingredientId: onion.id, quantity: "1", unit: "cup" },
    ]);
    await db.insert(scheduleEntries).values([
      { familyId: family.id, date: "2026-07-06", slot: "dinner", mealId: tacos.id, createdByUserId: user.id, updatedByUserId: user.id },
      { familyId: family.id, date: "2026-07-07", slot: "dinner", mealId: chili.id, createdByUserId: user.id, updatedByUserId: user.id },
    ]);
    const items = await generateDerivedItems(family.id, "2026-07-06", "2026-07-12");
    expect(items).toHaveLength(1);
    expect(items[0]!.ingredientId).toBe(onion.id);
    expect(items[0]!.quantity).toBe(3);
    expect(items[0]!.unit).toBe("cup");
    expect(items[0]!.category).toBe("produce");
    expect(items[0]!.sourceScheduleEntryIds).toHaveLength(2);
  });

  it("normalizes units before bucketing (tablespoon + T + tbsp aggregate)", async () => {
    const { family, user } = await seed();
    const oil = await makeIngredient(family.id, "Olive Oil", "pantry");
    const a = await makeMeal(family.id, "A");
    const b = await makeMeal(family.id, "B");
    const c = await makeMeal(family.id, "C");
    await db.insert(mealIngredients).values([
      { mealId: a.id, ingredientId: oil.id, quantity: "1", unit: "tablespoon" },
      { mealId: b.id, ingredientId: oil.id, quantity: "1", unit: "T" },
      { mealId: c.id, ingredientId: oil.id, quantity: "1", unit: "tbsp." },
    ]);
    await db.insert(scheduleEntries).values([
      { familyId: family.id, date: "2026-07-06", slot: "dinner", mealId: a.id, createdByUserId: user.id, updatedByUserId: user.id },
      { familyId: family.id, date: "2026-07-07", slot: "dinner", mealId: b.id, createdByUserId: user.id, updatedByUserId: user.id },
      { familyId: family.id, date: "2026-07-08", slot: "dinner", mealId: c.id, createdByUserId: user.id, updatedByUserId: user.id },
    ]);
    const items = await generateDerivedItems(family.id, "2026-07-06", "2026-07-12");
    expect(items).toHaveLength(1);
    expect(items[0]!.quantity).toBe(3);
    expect(items[0]!.unit).toBe("tbsp");
  });

  it("does NOT unit-convert (cups and grams of same ingredient stay separate)", async () => {
    const { family, user } = await seed();
    const onion = await makeIngredient(family.id, "Onion", "produce");
    const a = await makeMeal(family.id, "A");
    const b = await makeMeal(family.id, "B");
    await db.insert(mealIngredients).values([
      { mealId: a.id, ingredientId: onion.id, quantity: "1", unit: "cup" },
      { mealId: b.id, ingredientId: onion.id, quantity: "500", unit: "g" },
    ]);
    await db.insert(scheduleEntries).values([
      { familyId: family.id, date: "2026-07-06", slot: "dinner", mealId: a.id, createdByUserId: user.id, updatedByUserId: user.id },
      { familyId: family.id, date: "2026-07-07", slot: "dinner", mealId: b.id, createdByUserId: user.id, updatedByUserId: user.id },
    ]);
    const items = await generateDerivedItems(family.id, "2026-07-06", "2026-07-12");
    expect(items).toHaveLength(2);
    const units = items.map((i) => i.unit).sort();
    expect(units).toEqual(["cup", "g"]);
  });

  it("creates a unitless row when quantity or unit is missing (structured)", async () => {
    const { family, user } = await seed();
    const onion = await makeIngredient(family.id, "Onion", "produce");
    const a = await makeMeal(family.id, "A");
    const b = await makeMeal(family.id, "B");
    await db.insert(mealIngredients).values([
      { mealId: a.id, ingredientId: onion.id, quantity: null, unit: null, displayText: "some onion" },
      { mealId: b.id, ingredientId: onion.id, quantity: null, unit: null, displayText: "another onion" },
    ]);
    await db.insert(scheduleEntries).values([
      { familyId: family.id, date: "2026-07-06", slot: "dinner", mealId: a.id, createdByUserId: user.id, updatedByUserId: user.id },
      { familyId: family.id, date: "2026-07-07", slot: "dinner", mealId: b.id, createdByUserId: user.id, updatedByUserId: user.id },
    ]);
    const items = await generateDerivedItems(family.id, "2026-07-06", "2026-07-12");
    expect(items).toHaveLength(1);
    expect(items[0]!.ingredientId).toBe(onion.id);
    expect(items[0]!.quantity).toBeNull();
    expect(items[0]!.unit).toBeNull();
    expect(items[0]!.sourceScheduleEntryIds).toHaveLength(2);
  });

  it("groups display-text-only rows case-insensitively into a Misc bucket", async () => {
    const { family, user } = await seed();
    const a = await makeMeal(family.id, "A");
    const b = await makeMeal(family.id, "B");
    const c = await makeMeal(family.id, "C");
    await db.insert(mealIngredients).values([
      { mealId: a.id, ingredientId: null, displayText: "a handful of basil" },
      { mealId: b.id, ingredientId: null, displayText: "A Handful of Basil" },
      { mealId: c.id, ingredientId: null, displayText: "salt to taste" },
    ]);
    await db.insert(scheduleEntries).values([
      { familyId: family.id, date: "2026-07-06", slot: "dinner", mealId: a.id, createdByUserId: user.id, updatedByUserId: user.id },
      { familyId: family.id, date: "2026-07-07", slot: "dinner", mealId: b.id, createdByUserId: user.id, updatedByUserId: user.id },
      { familyId: family.id, date: "2026-07-08", slot: "dinner", mealId: c.id, createdByUserId: user.id, updatedByUserId: user.id },
    ]);
    const items = await generateDerivedItems(family.id, "2026-07-06", "2026-07-12");
    expect(items).toHaveLength(2);
    const basil = items.find((i) => i.displayText === "a handful of basil");
    expect(basil).toBeDefined();
    expect(basil!.category).toBe("other");
    expect(basil!.sourceScheduleEntryIds).toHaveLength(2);
  });

  it("counts default rows and per-profile overrides both", async () => {
    const { family, user, profile } = await seed();
    const rice = await makeIngredient(family.id, "Rice", "pantry");
    const beans = await makeIngredient(family.id, "Beans", "pantry");
    const a = await makeMeal(family.id, "Family default"); // uses rice
    const b = await makeMeal(family.id, "Sam's override"); // uses beans
    await db.insert(mealIngredients).values([
      { mealId: a.id, ingredientId: rice.id, quantity: "1", unit: "cup" },
      { mealId: b.id, ingredientId: beans.id, quantity: "1", unit: "can" },
    ]);
    await db.insert(scheduleEntries).values([
      { familyId: family.id, date: "2026-07-06", slot: "dinner", mealId: a.id, createdByUserId: user.id, updatedByUserId: user.id },
      { familyId: family.id, date: "2026-07-06", slot: "dinner", profileId: profile.id, mealId: b.id, createdByUserId: user.id, updatedByUserId: user.id },
    ]);
    const items = await generateDerivedItems(family.id, "2026-07-06", "2026-07-12");
    expect(items).toHaveLength(2);
    const names = items.map((i) => i.ingredientId).sort();
    expect(names).toEqual([rice.id, beans.id].sort());
  });

  it("filters by family and by date range", async () => {
    const { family, user } = await seed();
    const [otherFamily] = await db
      .insert(families)
      .values({ name: "Other", weekStartsOn: 1 })
      .returning();
    const rice = await makeIngredient(family.id, "Rice", "pantry");
    const meal = await makeMeal(family.id, "A");
    await db.insert(mealIngredients).values({
      mealId: meal.id,
      ingredientId: rice.id,
      quantity: "1",
      unit: "cup",
    });
    await db.insert(scheduleEntries).values([
      // Out of range
      { familyId: family.id, date: "2026-07-05", slot: "dinner", mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id },
      // Wrong family
      { familyId: otherFamily!.id, date: "2026-07-06", slot: "dinner", mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id },
    ]);
    const items = await generateDerivedItems(family.id, "2026-07-06", "2026-07-12");
    expect(items).toEqual([]);
  });
});
