import { and, arrayContains, asc, eq, ilike, sql } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { withFamily } from "@/lib/auth/with-family";
import { db } from "@/lib/db/client";
import { meals } from "@/lib/db/schema";

export const GET = apiHandler(async (req) => {
  const { familyId } = await withFamily();
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const tags = url.searchParams.getAll("tag").map((t) => t.trim().toLowerCase()).filter(Boolean);
  const includeArchived = url.searchParams.get("includeArchived") === "true";

  const conditions = [eq(meals.familyId, familyId)];
  if (!includeArchived) conditions.push(eq(meals.isArchived, false));
  if (q.length > 0) conditions.push(ilike(meals.name, `${q}%`));
  if (tags.length > 0) conditions.push(arrayContains(meals.tags, tags));

  const items = await db
    .select({
      id: meals.id,
      name: meals.name,
      tags: meals.tags,
      prepTimeMinutes: meals.prepTimeMinutes,
      cookTimeMinutes: meals.cookTimeMinutes,
      servings: meals.servings,
      updatedAt: meals.updatedAt,
    })
    .from(meals)
    .where(and(...conditions))
    .orderBy(asc(sql`lower(${meals.name})`));

  return { items };
});
