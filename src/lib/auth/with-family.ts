import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, familyUsers } from "@/lib/db/schema";
import { UnauthorizedError, ForbiddenError } from "./errors";

export interface FamilyContext {
  userId: string;
  familyId: string;
  clerkUserId: string;
}

export async function withFamily(): Promise<FamilyContext> {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) throw new UnauthorizedError();

  const user = await db.query.users.findFirst({
    where: eq(users.clerkUserId, clerkUserId),
  });
  if (!user) throw new UnauthorizedError("No internal user record for Clerk session");

  const membership = await db.query.familyUsers.findFirst({
    where: eq(familyUsers.userId, user.id),
  });
  if (!membership) throw new ForbiddenError("User has no family membership");

  return { userId: user.id, familyId: membership.familyId, clerkUserId };
}
