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
import { GET } from "@/app/api/meals/route";

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
