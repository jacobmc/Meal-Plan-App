import { describe, it, expect, beforeEach } from "vitest";
import "../helpers/auth";
import { setMockClerkUser } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { db } from "@/lib/db/client";
import { families, users, familyUsers, ingredients } from "@/lib/db/schema";
import { GET, POST } from "@/app/api/ingredients/route";

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

describe("GET /api/ingredients", () => {
  it("returns 401 without a session", async () => {
    setMockClerkUser(null);
    const res = await GET(new Request("http://localhost/api/ingredients?q=on"), ctx);
    expect(res.status).toBe(401);
  });
  it("returns prefix-matching ingredients for the family", async () => {
    const { family } = await seedFamily();
    await db.insert(ingredients).values([
      { familyId: family.id, name: "Onion", category: "produce" },
      { familyId: family.id, name: "Orange", category: "produce" },
      { familyId: family.id, name: "Tomato", category: "produce" },
    ]);
    const res = await GET(new Request("http://localhost/api/ingredients?q=on"), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.map((i: { name: string }) => i.name).sort()).toEqual(["Onion"]);
  });
  it("does not leak ingredients across families", async () => {
    const a = await seedFamily("user_a");
    setMockClerkUser(null);
    const b = await seedFamily("user_b");
    await db.insert(ingredients).values({ familyId: a.family.id, name: "Onion", category: "produce" });
    setMockClerkUser("user_b");
    const res = await GET(new Request("http://localhost/api/ingredients?q=on"), ctx);
    const body = await res.json();
    expect(body.items).toEqual([]);
  });
  it("rejects q shorter than 1 char", async () => {
    await seedFamily();
    const res = await GET(new Request("http://localhost/api/ingredients?q="), ctx);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/ingredients", () => {
  it("creates an ingredient", async () => {
    const { family } = await seedFamily();
    const req = new Request("http://localhost/api/ingredients", {
      method: "POST",
      body: JSON.stringify({ name: "Carrot", category: "produce" }),
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Carrot");
    expect(body.familyId).toBeUndefined(); // not exposed in response shape
  });
  it("returns 409 on case-insensitive duplicate within family", async () => {
    const { family } = await seedFamily();
    await db.insert(ingredients).values({ familyId: family.id, name: "Onion", category: "produce" });
    const req = new Request("http://localhost/api/ingredients", {
      method: "POST",
      body: JSON.stringify({ name: "onion", category: "produce" }),
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(409);
  });
});
