import { and, eq } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { withFamily } from "@/lib/auth/with-family";
import { db } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import { ProfileUpdateSchema } from "@/lib/validation/profile";
import { NotFoundError, ValidationError } from "@/lib/auth/errors";

type RouteCtx = { params: Promise<{ id: string }> };

export const PATCH = apiHandler<RouteCtx>(async (req, ctx) => {
  const { familyId, userId } = await withFamily();
  const { id } = await ctx.params;

  const json = await req.json();
  const parsed = ProfileUpdateSchema.safeParse(json);
  if (!parsed.success) {
    throw new ValidationError("Invalid profile payload", parsed.error.flatten());
  }

  const [updated] = await db
    .update(profiles)
    .set({
      ...parsed.data,
      updatedByUserId: userId,
      updatedAt: new Date(),
    })
    .where(and(eq(profiles.id, id), eq(profiles.familyId, familyId)))
    .returning();

  if (!updated) throw new NotFoundError("Profile not found");
  return updated;
});

export const DELETE = apiHandler<RouteCtx>(async (_req, ctx) => {
  const { familyId, userId } = await withFamily();
  const { id } = await ctx.params;

  const [updated] = await db
    .update(profiles)
    .set({ isActive: false, updatedByUserId: userId, updatedAt: new Date() })
    .where(and(eq(profiles.id, id), eq(profiles.familyId, familyId)))
    .returning();

  if (!updated) throw new NotFoundError("Profile not found");
  return updated;
});
