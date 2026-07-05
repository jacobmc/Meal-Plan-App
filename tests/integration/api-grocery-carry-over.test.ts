import { describe, it, expect, beforeEach } from "vitest";
import "../helpers/auth";
import { setMockClerkUser } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { families, users, familyUsers, groceryLists, groceryListItems } from "@/lib/db/schema";
import { POST as postCarryOver } from "@/app/api/grocery/lists/[id]/carry-over/route";

async function seedFamily(clerkUserId = "clerk_co1") {
  const [family] = await db.insert(families).values({ name: "F", weekStartsOn: 1 }).returning();
  const [user] = await db
    .insert(users)
    .values({ clerkUserId, email: `${clerkUserId}@t` })
    .returning();
  await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });
  return { family: family!, user: user!, clerkUserId };
}

async function makeList(familyId: string, name: string) {
  const [list] = await db
    .insert(groceryLists)
    .values({ familyId, name, startDate: "2026-07-06", endDate: "2026-07-12" })
    .returning();
  return list!;
}

beforeEach(async () => {
  await resetDb();
  setMockClerkUser(null);
});

describe("POST /api/grocery/lists/[id]/carry-over", () => {
  it("copies only unchecked items as manual; source untouched", async () => {
    const { family, user, clerkUserId } = await seedFamily();
    const src = await makeList(family.id, "src");
    const dst = await makeList(family.id, "dst");
    await db.insert(groceryListItems).values([
      { listId: src.id, displayText: "rice", category: "pantry", source: "derived", checked: false },
      {
        listId: src.id,
        displayText: "salt",
        category: "other",
        source: "derived",
        checked: true,
        checkedAt: new Date(),
        checkedByUserId: user.id,
      },
    ]);

    setMockClerkUser(clerkUserId);
    const res = await postCarryOver(
      new Request("http://x", { method: "POST", body: JSON.stringify({ toListId: dst.id }) }),
      { params: Promise.resolve({ id: src.id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { added: number };
    expect(body.added).toBe(1);

    const dstItems = await db.select().from(groceryListItems).where(eq(groceryListItems.listId, dst.id));
    expect(dstItems).toHaveLength(1);
    expect(dstItems[0]!.source).toBe("manual");
    expect(dstItems[0]!.displayText).toBe("rice");

    const srcItems = await db.select().from(groceryListItems).where(eq(groceryListItems.listId, src.id));
    expect(srcItems).toHaveLength(2);
  });

  it("400 when source === target", async () => {
    const { family, clerkUserId } = await seedFamily("clerk_co2");
    const src = await makeList(family.id, "src");
    setMockClerkUser(clerkUserId);
    const res = await postCarryOver(
      new Request("http://x", { method: "POST", body: JSON.stringify({ toListId: src.id }) }),
      { params: Promise.resolve({ id: src.id }) },
    );
    expect(res.status).toBe(400);
  });

  it("404 when target belongs to another family", async () => {
    const { family, clerkUserId } = await seedFamily("clerk_co3");
    const { family: other } = await seedFamily("clerk_co4");
    const src = await makeList(family.id, "src");
    const foreign = await makeList(other.id, "foreign");
    setMockClerkUser(clerkUserId);
    const res = await postCarryOver(
      new Request("http://x", { method: "POST", body: JSON.stringify({ toListId: foreign.id }) }),
      { params: Promise.resolve({ id: src.id }) },
    );
    expect(res.status).toBe(404);
  });
});
