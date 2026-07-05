import { describe, it, expect, beforeEach } from "vitest";
import "@/../tests/setup";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  families, users, familyUsers, ingredients, groceryLists, groceryListItems,
} from "@/lib/db/schema";
import { carryOverUnchecked } from "@/lib/grocery/carry-over";
import { resetDb } from "@/../tests/helpers/db";

async function seed() {
  const [family] = await db.insert(families).values({ name: "F", weekStartsOn: 1 }).returning();
  const [user] = await db.insert(users).values({ clerkUserId: "clerk_c1", email: "c1@t" }).returning();
  await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });
  return { family: family!, user: user! };
}

describe("carryOverUnchecked", () => {
  beforeEach(async () => await resetDb());

  it("copies only unchecked items and marks them source=manual on target", async () => {
    const { family, user } = await seed();
    const rice = await db.insert(ingredients).values({ familyId: family.id, name: "Rice", category: "pantry" }).returning();
    const [src] = await db.insert(groceryLists).values({
      familyId: family.id, name: "src", startDate: "2026-07-06", endDate: "2026-07-12",
      createdByUserId: user.id, updatedByUserId: user.id,
    }).returning();
    const [dst] = await db.insert(groceryLists).values({
      familyId: family.id, name: "dst", startDate: "2026-07-13", endDate: "2026-07-19",
      createdByUserId: user.id, updatedByUserId: user.id,
    }).returning();
    await db.insert(groceryListItems).values([
      { listId: src!.id, ingredientId: rice[0]!.id, quantity: "1", unit: "cup", category: "pantry", source: "derived", checked: false },
      { listId: src!.id, ingredientId: null, displayText: "salt", category: "other", source: "derived", checked: true, checkedAt: new Date(), checkedByUserId: user.id },
      { listId: src!.id, ingredientId: null, displayText: "paper towels", category: "other", source: "manual", checked: false },
    ]);

    const result = await carryOverUnchecked(src!.id, dst!.id, user.id);
    expect(result.added).toBe(2);

    const items = await db.select().from(groceryListItems).where(eq(groceryListItems.listId, dst!.id));
    expect(items).toHaveLength(2);
    for (const it of items) {
      expect(it.source).toBe("manual");
      expect(it.checked).toBe(false);
      expect(it.checkedAt).toBeNull();
    }
  });

  it("does not touch source rows", async () => {
    const { family, user } = await seed();
    const [src] = await db.insert(groceryLists).values({
      familyId: family.id, name: "src", startDate: "2026-07-06", endDate: "2026-07-12",
      createdByUserId: user.id, updatedByUserId: user.id,
    }).returning();
    const [dst] = await db.insert(groceryLists).values({
      familyId: family.id, name: "dst", startDate: "2026-07-13", endDate: "2026-07-19",
      createdByUserId: user.id, updatedByUserId: user.id,
    }).returning();
    await db.insert(groceryListItems).values({
      listId: src!.id, displayText: "salt", category: "other", source: "manual", checked: false,
    });
    await carryOverUnchecked(src!.id, dst!.id, user.id);
    const srcItems = await db.select().from(groceryListItems).where(eq(groceryListItems.listId, src!.id));
    expect(srcItems).toHaveLength(1);
  });
});
