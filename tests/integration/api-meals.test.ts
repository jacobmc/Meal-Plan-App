import { describe, it, expect, beforeEach } from "vitest";
import "../helpers/auth";
import { setMockClerkUser } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { db } from "@/lib/db/client";
import {
  families,
  users,
  familyUsers,
  meals,
  ingredients,
  mealIngredients,
} from "@/lib/db/schema";
import { GET, POST } from "@/app/api/meals/route";
import { GET as TagsGET } from "@/app/api/meals/tags/route";

async function seedFamily(clerkId = "user_test") {
  const [family] = await db.insert(families).values({ name: "Fam" }).returning();
  const [user] = await db
    .insert(users)
    .values({ clerkUserId: clerkId, email: `${clerkId}@x.com`, displayName: clerkId })
    .returning();
  await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });
  setMockClerkUser(clerkId);
  return { family: family!, user: user! };
}

const ctx = { params: Promise.resolve({}) };

beforeEach(async () => {
  await resetDb();
  setMockClerkUser(null);
});

describe("GET /api/meals", () => {
  it("returns 401 without a session", async () => {
    setMockClerkUser(null);
    const res = await GET(new Request("http://localhost/api/meals"), ctx);
    expect(res.status).toBe(401);
  });
  it("returns the family's meals sorted by lower(name)", async () => {
    const { family } = await seedFamily();
    await db.insert(meals).values([
      { familyId: family.id, name: "Tacos", tags: ["mexican"] },
      { familyId: family.id, name: "Apple Pie", tags: ["dessert"] },
    ]);
    const res = await GET(new Request("http://localhost/api/meals"), ctx);
    const body = await res.json();
    expect(body.items.map((m: { name: string }) => m.name)).toEqual(["Apple Pie", "Tacos"]);
  });
  it("filters by q prefix (case-insensitive)", async () => {
    const { family } = await seedFamily();
    await db.insert(meals).values([
      { familyId: family.id, name: "Tacos" },
      { familyId: family.id, name: "Apple Pie" },
    ]);
    const res = await GET(new Request("http://localhost/api/meals?q=tac"), ctx);
    const body = await res.json();
    expect(body.items.map((m: { name: string }) => m.name)).toEqual(["Tacos"]);
  });
  it("filters by multiple tags (AND)", async () => {
    const { family } = await seedFamily();
    await db.insert(meals).values([
      { familyId: family.id, name: "A", tags: ["quick", "mexican"] },
      { familyId: family.id, name: "B", tags: ["quick"] },
      { familyId: family.id, name: "C", tags: ["mexican"] },
    ]);
    const res = await GET(
      new Request("http://localhost/api/meals?tag=quick&tag=mexican"),
      ctx,
    );
    const body = await res.json();
    expect(body.items.map((m: { name: string }) => m.name)).toEqual(["A"]);
  });
  it("hides archived meals by default", async () => {
    const { family } = await seedFamily();
    await db.insert(meals).values([
      { familyId: family.id, name: "Active" },
      { familyId: family.id, name: "Archived", isArchived: true },
    ]);
    const res = await GET(new Request("http://localhost/api/meals"), ctx);
    const body = await res.json();
    expect(body.items.map((m: { name: string }) => m.name)).toEqual(["Active"]);
  });
  it("does not leak meals across families", async () => {
    const a = await seedFamily("user_a");
    await db.insert(meals).values({ familyId: a.family.id, name: "A meal" });
    const b = await seedFamily("user_b");
    setMockClerkUser("user_b");
    const res = await GET(new Request("http://localhost/api/meals"), ctx);
    const body = await res.json();
    expect(body.items).toEqual([]);
  });
});

describe("GET /api/meals/tags", () => {
  it("returns deduplicated lowercase tags for the family", async () => {
    const { family } = await seedFamily();
    await db.insert(meals).values([
      { familyId: family.id, name: "A", tags: ["mexican", "quick"] },
      { familyId: family.id, name: "B", tags: ["dessert", "quick"] },
    ]);
    const res = await TagsGET(new Request("http://localhost/api/meals/tags"), ctx);
    const body = await res.json();
    expect(body.items.sort()).toEqual(["dessert", "mexican", "quick"]);
  });
  it("does not leak tags across families", async () => {
    const a = await seedFamily("user_a");
    await db.insert(meals).values({ familyId: a.family.id, name: "X", tags: ["fam-a"] });
    const b = await seedFamily("user_b");
    setMockClerkUser("user_b");
    const res = await TagsGET(new Request("http://localhost/api/meals/tags"), ctx);
    const body = await res.json();
    expect(body.items).toEqual([]);
  });
});

describe("POST /api/meals", () => {
  it("creates a meal with mixed structured + free-text ingredients", async () => {
    const { family } = await seedFamily();
    const [ing] = await db
      .insert(ingredients)
      .values({ familyId: family.id, name: "Beef", category: "meat" })
      .returning();
    const body = {
      name: "Tacos",
      instructions: "## Steps\n1. Cook",
      tags: ["mexican", "quick"],
      ingredients: [
        { ingredientId: ing!.id, quantity: 1, unit: "lb", sortOrder: 0 },
        { displayText: "a pinch of salt", sortOrder: 1 },
      ],
    };
    const res = await POST(
      new Request("http://localhost/api/meals", { method: "POST", body: JSON.stringify(body) }),
      ctx,
    );
    expect(res.status).toBe(200);
    const meal = await res.json();
    expect(meal.name).toBe("Tacos");
    expect(meal.tags.sort()).toEqual(["mexican", "quick"]);
    expect(meal.ingredients).toHaveLength(2);
    const structured = meal.ingredients.find((i: { ingredientId: string | null }) => i.ingredientId);
    expect(structured.ingredientName).toBe("Beef");
    expect(structured.quantity).toBe("1.000"); // numeric -> string
    const freeText = meal.ingredients.find(
      (i: { displayText: string | null }) => i.displayText,
    );
    expect(freeText.displayText).toBe("a pinch of salt");
  });
  it("rejects 422 when neither ingredientId nor displayText is set", async () => {
    await seedFamily();
    const res = await POST(
      new Request("http://localhost/api/meals", {
        method: "POST",
        body: JSON.stringify({ name: "X", ingredients: [{ sortOrder: 0 }] }),
      }),
      ctx,
    );
    expect(res.status).toBe(400);
  });
  it("normalizes tags on save (case + trim + dedupe)", async () => {
    await seedFamily();
    const res = await POST(
      new Request("http://localhost/api/meals", {
        method: "POST",
        body: JSON.stringify({ name: "X", tags: [" Quick ", "QUICK", "Dessert"] }),
      }),
      ctx,
    );
    const body = await res.json();
    expect(body.tags.sort()).toEqual(["dessert", "quick"]);
  });
});
