import { describe, it, expect, beforeEach } from "vitest";
import "@/../tests/setup";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  families, users, familyUsers, ingredients, meals, mealIngredients,
  scheduleEntries, groceryLists, groceryListItems,
} from "@/lib/db/schema";
import { regenerateList } from "@/lib/grocery/regenerate";
import { resetDb } from "@/../tests/helpers/db";

async function seed() {
  const [family] = await db.insert(families).values({ name: "F", weekStartsOn: 1 }).returning();
  const [user] = await db.insert(users).values({ clerkUserId: "clerk_r1", email: "r1@t" }).returning();
  await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });
  return { family: family!, user: user! };
}

describe("regenerateList", () => {
  beforeEach(async () => await resetDb());

  it("preserves manual items across regenerate", async () => {
    const { family, user } = await seed();
    const [list] = await db.insert(groceryLists).values({
      familyId: family.id, name: "L1", startDate: "2026-07-06", endDate: "2026-07-12",
      createdByUserId: user.id, updatedByUserId: user.id,
    }).returning();
    await db.insert(groceryListItems).values({
      listId: list!.id, displayText: "paper towels", category: "other", source: "manual",
    });

    await regenerateList(list!.id, user.id);

    const items = await db.select().from(groceryListItems).where(eq(groceryListItems.listId, list!.id));
    expect(items).toHaveLength(1);
    expect(items[0]!.source).toBe("manual");
    expect(items[0]!.displayText).toBe("paper towels");
  });

  it("preserves checked state on derived rows whose key survives", async () => {
    const { family, user } = await seed();
    const rice = await db.insert(ingredients).values({ familyId: family.id, name: "Rice", category: "pantry" }).returning();
    const meal = await db.insert(meals).values({ familyId: family.id, name: "A" }).returning();
    await db.insert(mealIngredients).values({
      mealId: meal[0]!.id, ingredientId: rice[0]!.id, quantity: "1", unit: "cup",
    });
    await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-07-06", slot: "dinner", mealId: meal[0]!.id,
      createdByUserId: user.id, updatedByUserId: user.id,
    });

    const [list] = await db.insert(groceryLists).values({
      familyId: family.id, name: "L", startDate: "2026-07-06", endDate: "2026-07-12",
      createdByUserId: user.id, updatedByUserId: user.id,
    }).returning();

    // First regen — populates derived rows
    await regenerateList(list!.id, user.id);

    // Check off the rice row
    await db.update(groceryListItems)
      .set({ checked: true, checkedAt: new Date(), checkedByUserId: user.id })
      .where(and(eq(groceryListItems.listId, list!.id), eq(groceryListItems.ingredientId, rice[0]!.id)));

    // Add another meal that uses rice too — so the aggregation key survives
    const meal2 = await db.insert(meals).values({ familyId: family.id, name: "B" }).returning();
    await db.insert(mealIngredients).values({
      mealId: meal2[0]!.id, ingredientId: rice[0]!.id, quantity: "2", unit: "cup",
    });
    await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-07-07", slot: "dinner", mealId: meal2[0]!.id,
      createdByUserId: user.id, updatedByUserId: user.id,
    });

    await regenerateList(list!.id, user.id);

    const [ricRow] = await db.select().from(groceryListItems)
      .where(and(eq(groceryListItems.listId, list!.id), eq(groceryListItems.ingredientId, rice[0]!.id)));
    expect(ricRow!.checked).toBe(true);
    expect(ricRow!.checkedByUserId).toBe(user.id);
    expect(Number(ricRow!.quantity)).toBe(3);
  });

  it("drops derived rows whose key no longer appears", async () => {
    const { family, user } = await seed();
    const onion = await db.insert(ingredients).values({ familyId: family.id, name: "Onion", category: "produce" }).returning();
    const meal = await db.insert(meals).values({ familyId: family.id, name: "A" }).returning();
    await db.insert(mealIngredients).values({
      mealId: meal[0]!.id, ingredientId: onion[0]!.id, quantity: "1", unit: "cup",
    });
    const sched = await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-07-06", slot: "dinner", mealId: meal[0]!.id,
      createdByUserId: user.id, updatedByUserId: user.id,
    }).returning();

    const [list] = await db.insert(groceryLists).values({
      familyId: family.id, name: "L", startDate: "2026-07-06", endDate: "2026-07-12",
      createdByUserId: user.id, updatedByUserId: user.id,
    }).returning();
    await regenerateList(list!.id, user.id);

    // Remove the schedule entry — regenerate should drop the onion row
    await db.delete(scheduleEntries).where(eq(scheduleEntries.id, sched[0]!.id));

    await regenerateList(list!.id, user.id);

    const items = await db.select().from(groceryListItems).where(eq(groceryListItems.listId, list!.id));
    expect(items).toEqual([]);
  });

  it("touches last_regenerated_at and updated_by_user_id", async () => {
    const { family, user } = await seed();
    const [list] = await db.insert(groceryLists).values({
      familyId: family.id, name: "L", startDate: "2026-07-06", endDate: "2026-07-12",
      createdByUserId: user.id, updatedByUserId: user.id,
    }).returning();

    await regenerateList(list!.id, user.id);

    const [after] = await db.select().from(groceryLists).where(eq(groceryLists.id, list!.id));
    expect(after!.lastRegeneratedAt).toBeTruthy();
    expect(after!.updatedByUserId).toBe(user.id);
  });
});
