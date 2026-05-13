import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, families, familyUsers, profiles } from "@/lib/db/schema";
import { computeDisplayName } from "@/lib/webhooks/display-name";

type RouteCtx = { params: Promise<Record<string, string>> };

export async function POST(req: NextRequest, _ctx: RouteCtx): Promise<Response> {
  let evt;
  try {
    evt = await verifyWebhook(req);
  } catch (err) {
    console.error("Clerk webhook signature verification failed:", err);
    return new Response("Bad signature", { status: 400 });
  }

  try {
    if (evt.type === "user.created") {
      await handleUserCreated(evt.data);
    } else if (evt.type === "user.updated") {
      await handleUserUpdated(evt.data);
    } else if (evt.type === "user.deleted") {
      await handleUserDeleted(evt.data);
    }
    return new Response(null, { status: 200 });
  } catch (err) {
    console.error("Clerk webhook handler error:", { eventType: evt.type, err });
    return new Response("Internal error", { status: 500 });
  }
}

async function handleUserCreated(data: {
  id: string;
  email_addresses: { email_address: string }[];
  first_name: string | null;
  last_name: string | null;
}) {
  const clerkUserId = data.id;
  const email = data.email_addresses[0]?.email_address ?? null;
  const displayName = computeDisplayName(data.first_name, data.last_name, email);

  await db.transaction(async (tx) => {
    // Idempotent insert: ON CONFLICT DO NOTHING means a re-delivery returns no row.
    const inserted = await tx
      .insert(users)
      .values({ clerkUserId, email, displayName })
      .onConflictDoNothing({ target: users.clerkUserId })
      .returning({ id: users.id });

    if (inserted.length === 0) {
      // User already existed. Don't bootstrap again.
      return;
    }
    const userId = inserted[0]!.id;

    // Don't bootstrap a family if the user somehow already has one (defensive).
    const existingMembership = await tx
      .select({ familyId: familyUsers.familyId })
      .from(familyUsers)
      .where(eq(familyUsers.userId, userId))
      .limit(1);
    if (existingMembership.length > 0) return;

    const [family] = await tx
      .insert(families)
      .values({ name: `${displayName}'s Family` })
      .returning({ id: families.id });

    await tx.insert(familyUsers).values({ familyId: family!.id, userId });

    await tx.insert(profiles).values({
      familyId: family!.id,
      displayName,
      color: "#94a3b8",
      userId,
      createdByUserId: userId,
      updatedByUserId: userId,
    });
  });
}

async function handleUserUpdated(data: {
  id: string;
  email_addresses: { email_address: string }[];
  first_name: string | null;
  last_name: string | null;
}) {
  const email = data.email_addresses[0]?.email_address ?? null;
  const displayName = computeDisplayName(data.first_name, data.last_name, email);

  const updated = await db
    .update(users)
    .set({ email, displayName, updatedAt: new Date() })
    .where(eq(users.clerkUserId, data.id))
    .returning({ id: users.id });

  if (updated.length === 0) {
    console.warn("Clerk webhook user.updated: no matching user row", { clerkUserId: data.id });
  }
}

async function handleUserDeleted(data: { id?: string }) {
  if (!data.id) {
    console.warn("Clerk webhook user.deleted: missing id, skipping");
    return;
  }
  await db.delete(users).where(eq(users.clerkUserId, data.id));
}
