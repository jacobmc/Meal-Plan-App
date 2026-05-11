import { eq, asc } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { withFamily } from "@/lib/auth/with-family";
import { db } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import { ProfileCreateSchema } from "@/lib/validation/profile";
import { ValidationError } from "@/lib/auth/errors";

export const GET = apiHandler(async () => {
  const { familyId } = await withFamily();
  const items = await db
    .select()
    .from(profiles)
    .where(eq(profiles.familyId, familyId))
    .orderBy(asc(profiles.sortOrder), asc(profiles.createdAt));
  return { items };
});

export const POST = apiHandler(async (req) => {
  const { familyId, userId } = await withFamily();
  const json = await req.json();
  const parsed = ProfileCreateSchema.safeParse(json);
  if (!parsed.success) {
    throw new ValidationError("Invalid profile payload", parsed.error.flatten());
  }

  const [created] = await db
    .insert(profiles)
    .values({
      familyId,
      displayName: parsed.data.displayName,
      color: parsed.data.color,
      sortOrder: parsed.data.sortOrder ?? 0,
      userId: parsed.data.userId ?? null,
      createdByUserId: userId,
      updatedByUserId: userId,
    })
    .returning();
  return created;
});
