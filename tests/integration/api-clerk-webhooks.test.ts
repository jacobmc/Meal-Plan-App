import { describe, it, expect, beforeEach } from "vitest";
import "../helpers/clerk-webhook";
import { setMockWebhookEvent, setMockWebhookError } from "../helpers/clerk-webhook";
import { resetDb } from "../helpers/db";
import { db } from "@/lib/db/client";
import { users, families, familyUsers, profiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { POST } from "@/app/api/clerk/webhooks/route";

const ctx = { params: Promise.resolve({}) };

function userCreatedEvent(overrides: {
  id?: string;
  email?: string;
  firstName?: string | null;
  lastName?: string | null;
} = {}) {
  const id = overrides.id ?? "user_2abcdefghijklmnopqrstuvwxyz";
  const email = overrides.email ?? "ada@example.com";
  return {
    type: "user.created" as const,
    data: {
      id,
      email_addresses: [{ id: "idn_1", email_address: email }],
      first_name: overrides.firstName ?? "Ada",
      last_name: overrides.lastName ?? "Lovelace",
    },
  } as unknown as import("@clerk/backend/webhooks").WebhookEvent;
}

beforeEach(async () => {
  await resetDb();
});

describe("POST /api/clerk/webhooks — user.created", () => {
  it("bootstraps user + family + family_users + profile", async () => {
    setMockWebhookEvent(userCreatedEvent({ id: "user_alpha" }));
    const res = await POST(new Request("http://localhost/api/clerk/webhooks", { method: "POST" }), ctx);
    expect(res.status).toBe(200);

    const u = await db.query.users.findFirst({ where: eq(users.clerkUserId, "user_alpha") });
    expect(u).toBeTruthy();
    expect(u!.email).toBe("ada@example.com");
    expect(u!.displayName).toBe("Ada Lovelace");

    const fu = await db.select().from(familyUsers).where(eq(familyUsers.userId, u!.id));
    expect(fu).toHaveLength(1);

    const fam = await db.query.families.findFirst({ where: eq(families.id, fu[0]!.familyId) });
    expect(fam!.name).toBe("Ada Lovelace's Family");

    const profs = await db.select().from(profiles).where(eq(profiles.familyId, fam!.id));
    expect(profs).toHaveLength(1);
    expect(profs[0]!.displayName).toBe("Ada Lovelace");
    expect(profs[0]!.userId).toBe(u!.id);
  });

  it("is idempotent — second delivery does not duplicate any row", async () => {
    setMockWebhookEvent(userCreatedEvent({ id: "user_beta" }));
    await POST(new Request("http://localhost/api/clerk/webhooks", { method: "POST" }), ctx);
    // second delivery, same event
    setMockWebhookEvent(userCreatedEvent({ id: "user_beta" }));
    const res = await POST(new Request("http://localhost/api/clerk/webhooks", { method: "POST" }), ctx);
    expect(res.status).toBe(200);

    const u = await db.select().from(users).where(eq(users.clerkUserId, "user_beta"));
    expect(u).toHaveLength(1);
    const fam = await db.select().from(families);
    expect(fam).toHaveLength(1);
    const profs = await db.select().from(profiles);
    expect(profs).toHaveLength(1);
  });

  it("does not create a new family when the user already had a row", async () => {
    // Simulate the pre-bootstrap state: a users row exists from manual UPDATE,
    // already has family + profile. user.created should be a no-op.
    const [fam] = await db.insert(families).values({ name: "Preexisting" }).returning();
    const [u] = await db
      .insert(users)
      .values({ clerkUserId: "user_gamma", email: "g@x.com", displayName: "Gamma" })
      .returning();
    await db.insert(familyUsers).values({ familyId: fam!.id, userId: u!.id });

    setMockWebhookEvent(userCreatedEvent({ id: "user_gamma", firstName: "Gamma" }));
    const res = await POST(new Request("http://localhost/api/clerk/webhooks", { method: "POST" }), ctx);
    expect(res.status).toBe(200);

    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(families)).toHaveLength(1);
    expect(await db.select().from(familyUsers)).toHaveLength(1);
  });
});
