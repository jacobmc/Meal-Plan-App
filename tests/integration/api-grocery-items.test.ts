import { describe, it, expect, beforeEach } from "vitest";
import "../helpers/auth";
import { setMockClerkUser } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { db } from "@/lib/db/client";
import { families, users, familyUsers, groceryLists, groceryListItems } from "@/lib/db/schema";
import { POST as postItem } from "@/app/api/grocery/lists/[id]/items/route";
import { PATCH as patchItem, DELETE as deleteItem } from "@/app/api/grocery/lists/[id]/items/[itemId]/route";

async function seedFamily(clerkUserId = "clerk_it1") {
  const [family] = await db.insert(families).values({ name: "F", weekStartsOn: 1 }).returning();
  const [user] = await db
    .insert(users)
    .values({ clerkUserId, email: `${clerkUserId}@t` })
    .returning();
  await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });
  const [list] = await db
    .insert(groceryLists)
    .values({ familyId: family!.id, name: "L", startDate: "2026-07-06", endDate: "2026-07-12" })
    .returning();
  return { family: family!, user: user!, list: list!, clerkUserId };
}

beforeEach(async () => {
  await resetDb();
  setMockClerkUser(null);
});

describe("POST /api/grocery/lists/[id]/items", () => {
  it("creates a manual unchecked item and normalizes the unit", async () => {
    const { list, clerkUserId } = await seedFamily();
    setMockClerkUser(clerkUserId);
    const res = await postItem(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({ displayText: "olive oil", quantity: 2, unit: "tbsp.", category: "pantry" }),
      }),
      { params: Promise.resolve({ id: list.id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; checked: boolean; unit: string };
    expect(body.source).toBe("manual");
    expect(body.checked).toBe(false);
    expect(body.unit).toBe("tbsp");
  });

  it("rejects a body with neither ingredientId nor displayText", async () => {
    const { list, clerkUserId } = await seedFamily("clerk_it2");
    setMockClerkUser(clerkUserId);
    const res = await postItem(
      new Request("http://x", { method: "POST", body: JSON.stringify({ category: "produce" }) }),
      { params: Promise.resolve({ id: list.id }) },
    );
    expect(res.status).toBe(400);
  });

  it("404s when the list belongs to another family", async () => {
    const { list } = await seedFamily("clerk_it3");
    const { clerkUserId: intruder } = await seedFamily("clerk_it4");
    setMockClerkUser(intruder);
    const res = await postItem(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({ displayText: "x", category: "other" }),
      }),
      { params: Promise.resolve({ id: list.id }) },
    );
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/grocery/lists/[id]/items/[itemId]", () => {
  it("check-off populates checkedAt + checkedByUserId; uncheck clears both", async () => {
    const { user, list, clerkUserId } = await seedFamily("clerk_it5");
    const [item] = await db
      .insert(groceryListItems)
      .values({ listId: list.id, displayText: "salt", category: "other", source: "manual" })
      .returning();
    setMockClerkUser(clerkUserId);
    const reqCtx = { params: Promise.resolve({ id: list.id, itemId: item!.id }) };

    let res = await patchItem(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ checked: true }) }),
      reqCtx,
    );
    let body = (await res.json()) as { checked: boolean; checkedAt: string | null };
    expect(body.checked).toBe(true);
    expect(body.checkedAt).not.toBeNull();

    const { eq } = await import("drizzle-orm");
    const [row] = await db.select().from(groceryListItems).where(eq(groceryListItems.id, item!.id));
    expect(row!.checkedByUserId).toBe(user.id);

    res = await patchItem(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ checked: false }) }),
      reqCtx,
    );
    body = (await res.json()) as { checked: boolean; checkedAt: string | null };
    expect(body.checked).toBe(false);
    expect(body.checkedAt).toBeNull();
  });

  it("404s on cross-family item", async () => {
    const { list } = await seedFamily("clerk_it6");
    const [item] = await db
      .insert(groceryListItems)
      .values({ listId: list.id, displayText: "salt", category: "other", source: "manual" })
      .returning();
    const { clerkUserId: intruder } = await seedFamily("clerk_it7");
    setMockClerkUser(intruder);
    const res = await patchItem(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ checked: true }) }),
      { params: Promise.resolve({ id: list.id, itemId: item!.id }) },
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/grocery/lists/[id]/items/[itemId]", () => {
  it("removes the row", async () => {
    const { list, clerkUserId } = await seedFamily("clerk_it8");
    const [item] = await db
      .insert(groceryListItems)
      .values({ listId: list.id, displayText: "salt", category: "other", source: "manual" })
      .returning();
    setMockClerkUser(clerkUserId);
    const res = await deleteItem(new Request("http://x", { method: "DELETE" }), {
      params: Promise.resolve({ id: list.id, itemId: item!.id }),
    });
    expect(res.status).toBe(204);
    const rows = await db.select().from(groceryListItems);
    expect(rows).toHaveLength(0);
  });
});
