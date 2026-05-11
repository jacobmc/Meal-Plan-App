import { describe, it, expect, beforeEach } from "vitest";
import "../helpers/auth";
import { setMockClerkUser } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { db } from "@/lib/db/client";
import { families, users, familyUsers, profiles } from "@/lib/db/schema";
import { GET as listGET, POST as listPOST } from "@/app/api/profiles/route";
import { PATCH as itemPATCH, DELETE as itemDELETE } from "@/app/api/profiles/[id]/route";

let familyId: string;
let userId: string;

async function seed() {
  const [f] = await db.insert(families).values({ name: "T" }).returning();
  const [u] = await db.insert(users).values({ clerkUserId: "user_p", email: "p@x.com" }).returning();
  await db.insert(familyUsers).values({ familyId: f!.id, userId: u!.id });
  familyId = f!.id;
  userId = u!.id;
  setMockClerkUser("user_p");
}

beforeEach(async () => {
  await resetDb();
  await seed();
});

describe("GET /api/profiles", () => {
  it("returns family-scoped profiles only", async () => {
    const [otherFamily] = await db.insert(families).values({ name: "Other" }).returning();
    await db.insert(profiles).values([
      { familyId, displayName: "Mine A", color: "#111111", sortOrder: 0 },
      { familyId, displayName: "Mine B", color: "#222222", sortOrder: 1 },
      { familyId: otherFamily!.id, displayName: "Theirs", color: "#333333", sortOrder: 0 },
    ]);
    const res = await listGET(new Request("http://localhost/api/profiles"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.items.map((p: { displayName: string }) => p.displayName).sort()).toEqual(["Mine A", "Mine B"]);
  });
});

describe("POST /api/profiles", () => {
  it("creates a profile in the caller's family", async () => {
    const req = new Request("http://localhost/api/profiles", {
      method: "POST",
      body: JSON.stringify({ displayName: "New", color: "#abcdef" }),
      headers: { "content-type": "application/json" },
    });
    const res = await listPOST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.familyId).toBe(familyId);
    expect(body.displayName).toBe("New");
    expect(body.createdByUserId).toBe(userId);
  });

  it("returns 400 on invalid color", async () => {
    const req = new Request("http://localhost/api/profiles", {
      method: "POST",
      body: JSON.stringify({ displayName: "X", color: "not-a-color" }),
      headers: { "content-type": "application/json" },
    });
    const res = await listPOST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
  });
});

describe("PATCH /api/profiles/[id]", () => {
  it("updates only the caller's family's profile", async () => {
    const [own] = await db
      .insert(profiles)
      .values({ familyId, displayName: "Old", color: "#111111", sortOrder: 0 })
      .returning();
    const req = new Request(`http://localhost/api/profiles/${own!.id}`, {
      method: "PATCH",
      body: JSON.stringify({ displayName: "New" }),
      headers: { "content-type": "application/json" },
    });
    const res = await itemPATCH(req, { params: Promise.resolve({ id: own!.id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.displayName).toBe("New");
    expect(body.updatedByUserId).toBe(userId);
  });

  it("returns 404 when targeting another family's profile", async () => {
    const [otherFamily] = await db.insert(families).values({ name: "Other" }).returning();
    const [theirs] = await db
      .insert(profiles)
      .values({ familyId: otherFamily!.id, displayName: "Theirs", color: "#333333", sortOrder: 0 })
      .returning();
    const req = new Request(`http://localhost/api/profiles/${theirs!.id}`, {
      method: "PATCH",
      body: JSON.stringify({ displayName: "Hacked" }),
      headers: { "content-type": "application/json" },
    });
    const res = await itemPATCH(req, { params: Promise.resolve({ id: theirs!.id }) });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/profiles/[id]", () => {
  it("archives by setting is_active=false", async () => {
    const [own] = await db
      .insert(profiles)
      .values({ familyId, displayName: "Bye", color: "#111111", sortOrder: 0 })
      .returning();
    const req = new Request(`http://localhost/api/profiles/${own!.id}`, { method: "DELETE" });
    const res = await itemDELETE(req, { params: Promise.resolve({ id: own!.id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isActive).toBe(false);
  });
});
