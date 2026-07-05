import { describe, it, expect, beforeEach } from "vitest";
import "../helpers/auth";
import { setMockClerkUser } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { db } from "@/lib/db/client";
import {
  families,
  users,
  familyUsers,
  ingredients,
  meals,
  mealIngredients,
  scheduleEntries,
  groceryLists,
  groceryListItems,
} from "@/lib/db/schema";
import { POST as postRegenerate } from "@/app/api/grocery/lists/[id]/regenerate/route";

async function seedFamily(clerkUserId = "clerk_rg1") {
  const [family] = await db.insert(families).values({ name: "F", weekStartsOn: 1 }).returning();
  const [user] = await db
    .insert(users)
    .values({ clerkUserId, email: `${clerkUserId}@t` })
    .returning();
  await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });
  return { family: family!, user: user!, clerkUserId };
}

async function seedSchedule(familyId: string, userId: string) {
  const [rice] = await db
    .insert(ingredients)
    .values({ familyId, name: "Rice", category: "pantry" })
    .returning();
  const [meal] = await db.insert(meals).values({ familyId, name: "A" }).returning();
  await db
    .insert(mealIngredients)
    .values({ mealId: meal!.id, ingredientId: rice!.id, quantity: "1", unit: "cup" });
  const [entry] = await db
    .insert(scheduleEntries)
    .values({
      familyId,
      date: "2026-07-06",
      slot: "dinner",
      mealId: meal!.id,
      createdByUserId: userId,
      updatedByUserId: userId,
    })
    .returning();
  return { rice: rice!, meal: meal!, entry: entry! };
}

beforeEach(async () => {
  await resetDb();
  setMockClerkUser(null);
});

describe("POST /api/grocery/lists/[id]/regenerate", () => {
  it("reflects schedule edits and preserves manual items", async () => {
    const { family, user, clerkUserId } = await seedFamily();
    const { entry } = await seedSchedule(family.id, user.id);
    const [list] = await db
      .insert(groceryLists)
      .values({ familyId: family.id, name: "L", startDate: "2026-07-06", endDate: "2026-07-12" })
      .returning();
    await db.insert(groceryListItems).values({
      listId: list!.id,
      displayText: "paper towels",
      category: "other",
      source: "manual",
    });

    setMockClerkUser(clerkUserId);
    const reqCtx = { params: Promise.resolve({ id: list!.id }) };

    // First regenerate — derives rice + keeps manual row.
    let res = await postRegenerate(new Request("http://x", { method: "POST" }), reqCtx);
    expect(res.status).toBe(200);
    let body = (await res.json()) as { items: { source: string; ingredientName: string | null }[] };
    expect(body.items).toHaveLength(2);

    // Second regenerate with no changes — same items.
    res = await postRegenerate(new Request("http://x", { method: "POST" }), reqCtx);
    body = (await res.json()) as { items: { source: string; ingredientName: string | null }[] };
    expect(body.items).toHaveLength(2);

    // Remove the schedule entry — derived row drops, manual survives.
    const { eq } = await import("drizzle-orm");
    await db.delete(scheduleEntries).where(eq(scheduleEntries.id, entry.id));
    res = await postRegenerate(new Request("http://x", { method: "POST" }), reqCtx);
    body = (await res.json()) as { items: { source: string; ingredientName: string | null }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.source).toBe("manual");
  });

  it("404s on a cross-family list id", async () => {
    const { clerkUserId } = await seedFamily("clerk_rg2");
    const { family: other } = await seedFamily("clerk_rg3");
    const [list] = await db
      .insert(groceryLists)
      .values({ familyId: other.id, name: "L", startDate: "2026-07-06", endDate: "2026-07-12" })
      .returning();

    setMockClerkUser(clerkUserId);
    const res = await postRegenerate(new Request("http://x", { method: "POST" }), {
      params: Promise.resolve({ id: list!.id }),
    });
    expect(res.status).toBe(404);
  });
});
