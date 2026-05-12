import { and, asc, eq, ilike, sql } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { withFamily } from "@/lib/auth/with-family";
import { ConflictError, ValidationError } from "@/lib/auth/errors";
import { db } from "@/lib/db/client";
import { ingredients } from "@/lib/db/schema";
import { IngredientCreateSchema } from "@/lib/validation/ingredient";

export const GET = apiHandler(async (req) => {
  const { familyId } = await withFamily();
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  if (q.length < 1) {
    throw new ValidationError("q is required (min 1 char)");
  }
  const items = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      defaultUnit: ingredients.defaultUnit,
      category: ingredients.category,
    })
    .from(ingredients)
    .where(and(eq(ingredients.familyId, familyId), ilike(ingredients.name, `${q}%`)))
    .orderBy(asc(sql`lower(${ingredients.name})`))
    .limit(20);
  return { items };
});

export const POST = apiHandler(async (req) => {
  const { familyId } = await withFamily();
  const json = await req.json();
  const parsed = IngredientCreateSchema.safeParse(json);
  if (!parsed.success) {
    throw new ValidationError("Invalid ingredient payload", parsed.error.flatten());
  }
  try {
    const [created] = await db
      .insert(ingredients)
      .values({
        familyId,
        name: parsed.data.name,
        defaultUnit: parsed.data.defaultUnit ?? null,
        category: parsed.data.category,
      })
      .returning({
        id: ingredients.id,
        name: ingredients.name,
        defaultUnit: ingredients.defaultUnit,
        category: ingredients.category,
      });
    return created!;
  } catch (err) {
    const isUniqViolation =
      err instanceof Error &&
      (/ingredients_family_name_uniq/.test(err.message) ||
        (err.cause instanceof Error &&
          /ingredients_family_name_uniq/.test(err.cause.message)));
    if (isUniqViolation) {
      throw new ConflictError("Ingredient with that name already exists");
    }
    throw err;
  }
});
