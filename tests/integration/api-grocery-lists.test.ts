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
} from "@/lib/db/schema";
import { GET as getLists, POST as postList } from "@/app/api/grocery/lists/route";
import { PATCH as patchList, DELETE as deleteList } from "@/app/api/grocery/lists/[id]/route";

const ctx = { params: Promise.resolve({}) };

async function seedFamily(clerkUserId = "clerk_gl1") {
  const [family] = await db.insert(families).values({ name: "F", weekStartsOn: 1 }).returning();
  const [user] = await db
    .insert(users)
    .values({ clerkUserId, email: `${clerkUserId}@t` })
    .returning();
  await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });
  return { family: family!, user: user!, clerkUserId };
}

beforeEach(async () => {
  await resetDb();
  setMockClerkUser(null);
});

describe("POST /api/grocery/lists", () => {
  it("creates a list and populates derived items in one transaction", async () => {
    const { family, user, clerkUserId } = await seedFamily();
    const rice = await db
      .insert(ingredients)
      .values({ familyId: family.id, name: "Rice", category: "pantry" })
      .returning();
    const meal = await db.insert(meals).values({ familyId: family.id, name: "A" }).returning();
    await db
      .insert(mealIngredients)
      .values({ mealId: meal[0]!.id, ingredientId: rice[0]!.id, quantity: "1", unit: "cup" });
    await db.insert(scheduleEntries).values({
      familyId: family.id,
      date: "2026-07-06",
      slot: "dinner",
      mealId: meal[0]!.id,
      createdByUserId: user.id,
      updatedByUserId: user.id,
    });

    setMockClerkUser(clerkUserId);
    const req = new Request("http://x/api/grocery/lists", {
      method: "POST",
      body: JSON.stringify({ startDate: "2026-07-06", endDate: "2026-07-12" }),
    });
    const res = await postList(req, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; items: { ingredientName: string | null }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.ingredientName).toBe("Rice");
  });

  it("returns 4xx on invalid date range", async () => {
    const { clerkUserId } = await seedFamily();
    setMockClerkUser(clerkUserId);
    const req = new Request("http://x/api/grocery/lists", {
      method: "POST",
      body: JSON.stringify({ startDate: "2026-07-12", endDate: "2026-07-06" }),
    });
    const res = await postList(req, ctx);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe("GET /api/grocery/lists", () => {
  it("lists only the caller's family", async () => {
    const { family: a, clerkUserId: ck } = await seedFamily("clerk_gl2");
    const { family: b } = await seedFamily("clerk_gl3");
    await db.insert(groceryLists).values([
      { familyId: a.id, name: "mine", startDate: "2026-07-06", endDate: "2026-07-12" },
      { familyId: b.id, name: "theirs", startDate: "2026-07-06", endDate: "2026-07-12" },
    ]);
    setMockClerkUser(ck);
    const res = await getLists(new Request("http://x/api/grocery/lists"), ctx);
    const body = (await res.json()) as { items: { name: string }[] };
    expect(body.items.map((i) => i.name)).toEqual(["mine"]);
  });

  it("excludes archived by default and includes with query param", async () => {
    const { family, clerkUserId } = await seedFamily("clerk_gl4");
    await db.insert(groceryLists).values([
      { familyId: family.id, name: "active", startDate: "2026-07-06", endDate: "2026-07-12" },
      { familyId: family.id, name: "old", startDate: "2026-06-01", endDate: "2026-06-07", isArchived: true },
    ]);
    setMockClerkUser(clerkUserId);

    let res = await getLists(new Request("http://x/api/grocery/lists"), ctx);
    let body = (await res.json()) as { items: { name: string }[] };
    expect(body.items.map((i) => i.name)).toEqual(["active"]);

    res = await getLists(new Request("http://x/api/grocery/lists?includeArchived=true"), ctx);
    body = (await res.json()) as { items: { name: string }[] };
    expect(body.items.length).toBe(2);
  });
});

describe("PATCH /api/grocery/lists/[id]", () => {
  it("regenerates when the date range changes", async () => {
    const { family, user, clerkUserId } = await seedFamily("clerk_gl_patch");
    const rice = await db
      .insert(ingredients)
      .values({ familyId: family.id, name: "Rice", category: "pantry" })
      .returning();
    const meal = await db.insert(meals).values({ familyId: family.id, name: "A" }).returning();
    await db
      .insert(mealIngredients)
      .values({ mealId: meal[0]!.id, ingredientId: rice[0]!.id, quantity: "1", unit: "cup" });
    const [list] = await db
      .insert(groceryLists)
      .values({
        familyId: family.id,
        name: "L",
        startDate: "2026-07-06",
        endDate: "2026-07-06",
        createdByUserId: user.id,
        updatedByUserId: user.id,
      })
      .returning();
    await db.insert(scheduleEntries).values({
      familyId: family.id,
      date: "2026-07-08",
      slot: "dinner",
      mealId: meal[0]!.id,
      createdByUserId: user.id,
      updatedByUserId: user.id,
    });

    setMockClerkUser(clerkUserId);
    const req = new Request(`http://x/api/grocery/lists/${list!.id}`, {
      method: "PATCH",
      body: JSON.stringify({ endDate: "2026-07-12" }),
    });
    const res = await patchList(req, { params: Promise.resolve({ id: list!.id }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(1);
  });

  it("archives without touching items", async () => {
    const { family, clerkUserId } = await seedFamily("clerk_gl_arch");
    const [list] = await db
      .insert(groceryLists)
      .values({ familyId: family.id, name: "L", startDate: "2026-07-06", endDate: "2026-07-12" })
      .returning();
    setMockClerkUser(clerkUserId);
    const res = await patchList(
      new Request(`http://x/api/grocery/lists/${list!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isArchived: true }),
      }),
      { params: Promise.resolve({ id: list!.id }) },
    );
    const body = (await res.json()) as { isArchived: boolean };
    expect(body.isArchived).toBe(true);
  });
});

describe("DELETE /api/grocery/lists/[id]", () => {
  it("deletes own list, 404s on another family's list", async () => {
    const { family, clerkUserId } = await seedFamily("clerk_gl_del");
    const { family: other } = await seedFamily("clerk_gl_del2");
    const [mine] = await db
      .insert(groceryLists)
      .values({ familyId: family.id, name: "mine", startDate: "2026-07-06", endDate: "2026-07-12" })
      .returning();
    const [theirs] = await db
      .insert(groceryLists)
      .values({ familyId: other.id, name: "theirs", startDate: "2026-07-06", endDate: "2026-07-12" })
      .returning();

    setMockClerkUser(clerkUserId);
    const okRes = await deleteList(new Request(`http://x/api/grocery/lists/${mine!.id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: mine!.id }),
    });
    expect(okRes.status).toBe(204);

    const notFound = await deleteList(
      new Request(`http://x/api/grocery/lists/${theirs!.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: theirs!.id }) },
    );
    expect(notFound.status).toBe(404);
  });
});
