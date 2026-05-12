import { and, arrayContains, asc, eq, ilike, inArray, sql } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { ValidationError } from "@/lib/auth/errors";
import { withFamily } from "@/lib/auth/with-family";
import { db } from "@/lib/db/client";
import { meals, mealIngredients, ingredients } from "@/lib/db/schema";
import { MealCreateSchema } from "@/lib/validation/meal";
import { fetchMealDetail } from "./_meal-detail";

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

export const POST = apiHandler(async (req) => {
  const { familyId, userId } = await withFamily();
  const json = await req.json();
  const parsed = MealCreateSchema.safeParse(json);
  if (!parsed.success) {
    throw new ValidationError("Invalid meal payload", parsed.error.flatten());
  }

  // Validate that any referenced ingredientIds belong to this family
  const ingredientIds = parsed.data.ingredients
    .map((r) => r.ingredientId)
    .filter((v): v is string => Boolean(v));
  if (ingredientIds.length > 0) {
    const owned = await db
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(and(eq(ingredients.familyId, familyId), inArray(ingredients.id, ingredientIds)));
    if (owned.length !== new Set(ingredientIds).size) {
      throw new ValidationError("One or more ingredient IDs are invalid");
    }
  }

  const newMeal = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(meals)
      .values({
        familyId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        instructions: parsed.data.instructions ?? null,
        prepTimeMinutes: parsed.data.prepTimeMinutes ?? null,
        cookTimeMinutes: parsed.data.cookTimeMinutes ?? null,
        servings: parsed.data.servings ?? null,
        sourceUrl: parsed.data.sourceUrl ?? null,
        tags: parsed.data.tags,
        createdByUserId: userId,
        updatedByUserId: userId,
      })
      .returning();

    if (parsed.data.ingredients.length > 0) {
      await tx.insert(mealIngredients).values(
        parsed.data.ingredients.map((r) => ({
          mealId: created!.id,
          ingredientId: r.ingredientId ?? null,
          displayText: r.displayText ?? null,
          quantity: r.quantity != null ? String(r.quantity) : null,
          unit: r.unit ?? null,
          sortOrder: r.sortOrder,
        })),
      );
    }
    return created!;
  });

  return await fetchMealDetail(newMeal.id, familyId);
});
