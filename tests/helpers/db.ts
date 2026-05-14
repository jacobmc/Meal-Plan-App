import { db } from "@/lib/db/client";
import {
  scheduleEntries,
  mealIngredients,
  meals,
  ingredients,
  profiles,
  familyUsers,
  users,
  families,
} from "@/lib/db/schema";

export async function resetDb() {
  // Order matters: cascade-aware deletion. Children first, then parents.
  await db.delete(scheduleEntries);
  await db.delete(mealIngredients);
  await db.delete(meals);
  await db.delete(ingredients);
  await db.delete(profiles);
  await db.delete(familyUsers);
  await db.delete(users);
  await db.delete(families);
}
