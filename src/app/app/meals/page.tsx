import { and, arrayContains, asc, eq, ilike, sql } from "drizzle-orm";
import { withFamily } from "@/lib/auth/with-family";
import { db } from "@/lib/db/client";
import { meals } from "@/lib/db/schema";
import { MealList } from "@/components/meal-list";

interface PageProps {
  searchParams: Promise<{ q?: string; tag?: string | string[] }>;
}

export default async function MealsPage({ searchParams }: PageProps) {
  const { familyId } = await withFamily();
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const tagsRaw = params.tag;
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw
    : typeof tagsRaw === "string"
      ? [tagsRaw]
      : [];

  const conditions = [eq(meals.familyId, familyId), eq(meals.isArchived, false)];
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
    })
    .from(meals)
    .where(and(...conditions))
    .orderBy(asc(sql`lower(${meals.name})`));

  return <MealList initialItems={items} initialQuery={q} initialTags={tags} />;
}
