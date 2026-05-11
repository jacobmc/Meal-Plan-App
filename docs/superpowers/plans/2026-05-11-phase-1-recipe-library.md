# Phase 1 Recipe Library — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the meal-inventory slice of the meal-plan app — text-only recipes with optional structured ingredients, free-text tags, prefix search, and tag filtering. Sequential predecessor to Phase 2 (weekly calendar).

**Architecture:** Drizzle schema adds three tables (`meals`, `ingredients`, `meal_ingredients`). REST API under `/api/meals/*` and `/api/ingredients` uses the Phase 0 conventions (`apiHandler` + `withFamily` + Zod). Pages under `/app/meals/*` are RSC for reads, with client-component islands handling search/filter, the meal editor form, and the ingredient autocomplete. URL search params drive filters so back-button and shareable links work. Migrations run automatically during the Vercel `vercel-build` script.

**Tech Stack:** Next.js 16 (App Router, Turbopack dev / Webpack build), TypeScript, Drizzle ORM + Neon Postgres, Clerk auth, Zod validation, shadcn/ui + Tailwind v4, react-hook-form, react-markdown, @dnd-kit/sortable, Vitest, Playwright.

**Source design spec:** [docs/superpowers/specs/2026-05-11-phase-1-recipe-library-design.md](../specs/2026-05-11-phase-1-recipe-library-design.md). Read this before starting.

**AGENTS.md callout:** `AGENTS.md` reads "This is NOT the Next.js you know" — when in doubt about a Next API (route handler signatures, dynamic route params, RSC vs client conventions), consult `node_modules/next/dist/docs/` before writing the code. Phase 0 hit several drift bugs because of this.

---

## File map

### Created

```
drizzle/<NNNN>_<auto-name>.sql               Generated migration
src/lib/validation/meal.ts                   Zod schemas: MealCreate / MealUpdate / MealIngredientInput
src/lib/validation/ingredient.ts             Zod schemas: IngredientCreate
src/app/api/ingredients/route.ts             GET (q prefix) + POST
src/app/api/meals/route.ts                   GET (list with q + tag filters) + POST
src/app/api/meals/tags/route.ts              GET distinct tags
src/app/api/meals/[id]/route.ts              GET + PATCH + DELETE
src/app/app/meals/page.tsx                   RSC list page (server-fetches, renders <MealList />)
src/app/app/meals/new/page.tsx               RSC entry, renders <MealForm />
src/app/app/meals/[id]/page.tsx              RSC detail page
src/app/app/meals/[id]/edit/page.tsx         RSC entry, renders <MealForm initial={...} />
src/components/meal-list.tsx                 Client island — search + tag chips + URL push
src/components/meal-list-item.tsx            Single row in list
src/components/meal-form.tsx                 Create / edit form (react-hook-form + Zod)
src/components/meal-ingredient-row.tsx       Sub-form row (dnd-kit sortable)
src/components/ingredient-combobox.tsx       Autocomplete input with "Create new" affordance
src/components/markdown-editor.tsx           Edit/Preview tabbed textarea
src/components/markdown-view.tsx             Read-only react-markdown renderer
src/components/tag-input.tsx                 Chip input with autocomplete
tests/unit/validation-meal.test.ts
tests/unit/validation-ingredient.test.ts
tests/integration/api-ingredients.test.ts
tests/integration/api-meals.test.ts
```

### Modified

```
package.json                                 Add deps: react-markdown, @dnd-kit/core, @dnd-kit/sortable
src/lib/db/schema.ts                         Add meals, ingredients, mealIngredients + types
src/app/app/layout.tsx                       Add "Recipes" nav link → /app/meals
tests/helpers/db.ts                          resetDb() drops meal_ingredients, meals, ingredients too
tests/e2e/smoke.spec.ts                      Add gated recipe-flow E2E
src/components/ui/                           Add shadcn primitives (badge, tabs, command/popover) if missing
```

---

## Task 1: Install runtime dependencies

**Files:**
- Modify: `package.json`

All UI primitives we need (Button, Card, Input, Label) are already in `src/components/ui/` from Phase 0. The markdown tabs, tag chips, ingredient combobox, and meal-list cards are hand-rolled rather than via shadcn `command`/`popover`/`tabs`/`badge`, so no shadcn add is needed.

If a later task surfaces a need for a shadcn primitive, install it then. Reminder: the repo's Button is base-ui (`@base-ui/react`) and does **not** support `asChild` — use `buttonVariants()` on the inner element instead (see [src/app/page.tsx](src/app/page.tsx)).

- [ ] **Step 1: Install runtime deps**

```bash
pnpm add react-markdown @dnd-kit/core @dnd-kit/sortable
```

Expected: 3 packages added, `pnpm-lock.yaml` updated.

- [ ] **Step 2: Verify build still passes**

```bash
pnpm build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(phase-1): add react-markdown + dnd-kit"
```

---

## Task 2: Database schema — meals, ingredients, meal_ingredients

**Files:**
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: Add the three tables and types**

Append to `src/lib/db/schema.ts` (after the existing `profiles` table and its types). Imports at the top already include `pgTable, uuid, text, timestamp, smallint, boolean, index, uniqueIndex` — add `integer`, `numeric`, `check`:

```ts
import {
  // ...existing imports
  integer,
  numeric,
  check,
} from "drizzle-orm/pg-core";
```

Then the tables:

```ts
export const meals = pgTable(
  "meals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    instructions: text("instructions"),
    prepTimeMinutes: integer("prep_time_minutes"),
    cookTimeMinutes: integer("cook_time_minutes"),
    servings: integer("servings"),
    sourceUrl: text("source_url"),
    imageUrl: text("image_url"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    isArchived: boolean("is_archived").notNull().default(false),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    familyNameIdx: index("meals_family_name_idx").on(table.familyId, sql`lower(${table.name})`),
    familyActiveIdx: index("meals_family_active_idx")
      .on(table.familyId)
      .where(sql`not ${table.isArchived}`),
    tagsGinIdx: index("meals_tags_gin_idx").using("gin", table.tags),
  }),
);

export const ingredients = pgTable(
  "ingredients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    defaultUnit: text("default_unit"),
    category: text("category").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    nameUniq: uniqueIndex("ingredients_family_name_uniq").on(
      table.familyId,
      sql`lower(${table.name})`,
    ),
    categoryIdx: index("ingredients_family_category_idx").on(table.familyId, table.category),
    categoryCheck: check(
      "ingredients_category_check",
      sql`${table.category} in ('produce','meat','dairy','pantry','frozen','bakery','other')`,
    ),
  }),
);

export const mealIngredients = pgTable(
  "meal_ingredients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mealId: uuid("meal_id")
      .notNull()
      .references(() => meals.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id").references(() => ingredients.id, {
      onDelete: "restrict",
    }),
    displayText: text("display_text"),
    quantity: numeric("quantity", { precision: 10, scale: 3 }),
    unit: text("unit"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => ({
    mealIdx: index("meal_ingredients_meal_idx").on(table.mealId),
    hybridCheck: check(
      "meal_ingredients_hybrid_check",
      sql`${table.ingredientId} is not null or ${table.displayText} is not null`,
    ),
  }),
);

export type Meal = typeof meals.$inferSelect;
export type NewMeal = typeof meals.$inferInsert;
export type Ingredient = typeof ingredients.$inferSelect;
export type NewIngredient = typeof ingredients.$inferInsert;
export type MealIngredient = typeof mealIngredients.$inferSelect;
export type NewMealIngredient = typeof mealIngredients.$inferInsert;
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: clean. If imports fail, recheck the `import` block at top of `schema.ts`.

- [ ] **Step 3: Commit (schema only — migration in next task)**

```bash
git add src/lib/db/schema.ts
git commit -m "feat(db): add meals, ingredients, meal_ingredients schema"
```

---

## Task 3: Generate and verify the migration

**Files:**
- Create: `drizzle/<NNNN>_<auto-name>.sql`

- [ ] **Step 1: Generate the migration**

```bash
pnpm db:generate
```

Expected: a new file under `drizzle/` like `drizzle/0001_<adjective>_<noun>.sql`.

- [ ] **Step 2: Inspect the migration**

Open the generated file. Confirm it contains: three `CREATE TABLE` statements (meals, ingredients, meal_ingredients), all six indexes from the spec (`meals_family_name_idx`, `meals_family_active_idx`, `meals_tags_gin_idx`, `ingredients_family_name_uniq`, `ingredients_family_category_idx`, `meal_ingredients_meal_idx`), and both CHECK constraints.

If anything is missing, edit `src/lib/db/schema.ts` until the regenerated migration matches the spec, then commit a fresh schema and regenerate.

- [ ] **Step 3: Apply to local Docker Postgres**

Local Postgres is on port 5433. `drizzle.config.ts` reads `DATABASE_URL` from `.env.local`.

```bash
pnpm db:migrate
```

Expected: `0 / 1 migrations applied` → `1 / 1 migrations applied` (or `1 / 2` if Phase 0 had already been applied). Verify with:

```bash
docker exec mealplan-postgres psql -U postgres -d mealplan -c "\dt"
```

Expected: includes `meals`, `ingredients`, `meal_ingredients` alongside existing tables.

- [ ] **Step 4: Apply to local test DB**

```bash
DATABASE_URL="postgres://postgres:postgres@localhost:5433/mealplan_test" pnpm db:migrate
```

Expected: same `1 / 1` (or equivalent). Verify with:

```bash
docker exec mealplan-postgres psql -U postgres -d mealplan_test -c "\dt"
```

- [ ] **Step 5: Commit**

```bash
git add drizzle
git commit -m "feat(db): migration for meals + ingredients + meal_ingredients"
```

---

## Task 4: Extend resetDb helper for new tables

**Files:**
- Modify: `tests/helpers/db.ts`

- [ ] **Step 1: Add the new tables to resetDb**

Replace `tests/helpers/db.ts` contents with:

```ts
import { db } from "@/lib/db/client";
import {
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
  await db.delete(mealIngredients);
  await db.delete(meals);
  await db.delete(ingredients);
  await db.delete(profiles);
  await db.delete(familyUsers);
  await db.delete(users);
  await db.delete(families);
}
```

- [ ] **Step 2: Run the existing tests**

```bash
pnpm test
```

Expected: 18/18 still passing. If any fail, the order in `resetDb` is wrong — re-check FK chains.

- [ ] **Step 3: Commit**

```bash
git add tests/helpers/db.ts
git commit -m "test: extend resetDb for phase-1 tables"
```

---

## Task 5: Zod schemas for meals and ingredients (TDD)

**Files:**
- Create: `src/lib/validation/meal.ts`, `src/lib/validation/ingredient.ts`
- Create: `tests/unit/validation-meal.test.ts`, `tests/unit/validation-ingredient.test.ts`

- [ ] **Step 1: Write the failing tests — meal validation**

Create `tests/unit/validation-meal.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  MealCreateSchema,
  MealUpdateSchema,
  MealIngredientInputSchema,
} from "@/lib/validation/meal";

describe("MealIngredientInputSchema", () => {
  it("accepts a row with only ingredientId", () => {
    const r = MealIngredientInputSchema.safeParse({
      ingredientId: "11111111-1111-1111-1111-111111111111",
      sortOrder: 0,
    });
    expect(r.success).toBe(true);
  });
  it("accepts a row with only displayText", () => {
    const r = MealIngredientInputSchema.safeParse({
      displayText: "a pinch of salt",
      sortOrder: 0,
    });
    expect(r.success).toBe(true);
  });
  it("rejects a row with neither ingredientId nor displayText", () => {
    const r = MealIngredientInputSchema.safeParse({ sortOrder: 0 });
    expect(r.success).toBe(false);
  });
  it("rejects negative quantity", () => {
    const r = MealIngredientInputSchema.safeParse({
      displayText: "x",
      quantity: -1,
      sortOrder: 0,
    });
    expect(r.success).toBe(false);
  });
});

describe("MealCreateSchema", () => {
  const valid = {
    name: "Tacos",
    instructions: "## Steps\n1. ...",
    tags: ["mexican", "quick"],
    ingredients: [{ displayText: "1 lb beef", sortOrder: 0 }],
  };
  it("accepts a minimal valid meal", () => {
    expect(MealCreateSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects empty name", () => {
    expect(MealCreateSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });
  it("rejects name longer than 120 chars", () => {
    expect(MealCreateSchema.safeParse({ ...valid, name: "x".repeat(121) }).success).toBe(false);
  });
  it("rejects more than 10 tags", () => {
    expect(
      MealCreateSchema.safeParse({ ...valid, tags: Array(11).fill("t") }).success,
    ).toBe(false);
  });
  it("normalizes tags to lowercase + trimmed + deduped", () => {
    const r = MealCreateSchema.parse({ ...valid, tags: [" Quick ", "QUICK", "Mexican"] });
    expect(r.tags.sort()).toEqual(["mexican", "quick"]);
  });
  it("rejects more than 50 ingredient rows", () => {
    const tooMany = Array(51).fill({ displayText: "x", sortOrder: 0 });
    expect(MealCreateSchema.safeParse({ ...valid, ingredients: tooMany }).success).toBe(false);
  });
});

describe("MealUpdateSchema", () => {
  it("accepts a partial payload", () => {
    expect(MealUpdateSchema.safeParse({ name: "Renamed" }).success).toBe(true);
  });
});
```

Create `tests/unit/validation-ingredient.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { IngredientCreateSchema } from "@/lib/validation/ingredient";

describe("IngredientCreateSchema", () => {
  const valid = { name: "Onion", category: "produce" as const };
  it("accepts a valid ingredient", () => {
    expect(IngredientCreateSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects bad category", () => {
    expect(
      IngredientCreateSchema.safeParse({ ...valid, category: "bogus" }).success,
    ).toBe(false);
  });
  it("trims and collapses interior whitespace on name", () => {
    const r = IngredientCreateSchema.parse({ ...valid, name: "  Red   Onion  " });
    expect(r.name).toBe("Red Onion");
  });
  it("rejects empty name", () => {
    expect(IngredientCreateSchema.safeParse({ ...valid, name: " " }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

```bash
pnpm test tests/unit/validation-meal.test.ts tests/unit/validation-ingredient.test.ts
```

Expected: FAIL — cannot import (schemas don't exist yet).

- [ ] **Step 3: Implement the schemas**

Create `src/lib/validation/ingredient.ts`:

```ts
import { z } from "zod";

export const INGREDIENT_CATEGORIES = [
  "produce",
  "meat",
  "dairy",
  "pantry",
  "frozen",
  "bakery",
  "other",
] as const;

export type IngredientCategory = (typeof INGREDIENT_CATEGORIES)[number];

const normalizeName = (s: string) => s.trim().replace(/\s+/g, " ");

export const IngredientCreateSchema = z.object({
  name: z
    .string()
    .transform(normalizeName)
    .pipe(z.string().min(1).max(80)),
  defaultUnit: z.string().max(30).optional().nullable(),
  category: z.enum(INGREDIENT_CATEGORIES),
});

export type IngredientCreate = z.infer<typeof IngredientCreateSchema>;
```

Create `src/lib/validation/meal.ts`:

```ts
import { z } from "zod";

const normalizeTag = (s: string) => s.trim().toLowerCase();

const TagsSchema = z
  .array(z.string().min(1).max(30))
  .max(10)
  .transform((arr) => Array.from(new Set(arr.map(normalizeTag).filter(Boolean))));

export const MealIngredientInputSchema = z
  .object({
    ingredientId: z.string().uuid().nullable().optional(),
    displayText: z.string().min(1).max(200).nullable().optional(),
    quantity: z.number().min(0).max(9999.999).nullable().optional(),
    unit: z.string().max(30).nullable().optional(),
    sortOrder: z.number().int().min(0).max(99).default(0),
  })
  .refine(
    (r) => Boolean(r.ingredientId) || Boolean(r.displayText && r.displayText.trim().length > 0),
    { message: "Either ingredientId or displayText is required" },
  );

export const MealCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  instructions: z.string().max(20_000).optional().nullable(),
  prepTimeMinutes: z.number().int().min(0).max(999).optional().nullable(),
  cookTimeMinutes: z.number().int().min(0).max(999).optional().nullable(),
  servings: z.number().int().min(1).max(99).optional().nullable(),
  sourceUrl: z.string().url().max(500).optional().nullable(),
  tags: TagsSchema.default([]),
  ingredients: z.array(MealIngredientInputSchema).max(50).default([]),
});

export const MealUpdateSchema = MealCreateSchema.partial();

export type MealCreate = z.infer<typeof MealCreateSchema>;
export type MealUpdate = z.infer<typeof MealUpdateSchema>;
export type MealIngredientInput = z.infer<typeof MealIngredientInputSchema>;
```

- [ ] **Step 4: Run tests, confirm green**

```bash
pnpm test tests/unit/validation-meal.test.ts tests/unit/validation-ingredient.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Run typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/validation tests/unit/validation-meal.test.ts tests/unit/validation-ingredient.test.ts
git commit -m "feat(validation): zod schemas for meals + ingredients"
```

---

## Task 6: API — `/api/ingredients` (GET prefix + POST) (TDD)

**Files:**
- Create: `src/app/api/ingredients/route.ts`, `tests/integration/api-ingredients.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/api-ingredients.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import "../helpers/auth";
import { setMockClerkUser } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { db } from "@/lib/db/client";
import { families, users, familyUsers, ingredients } from "@/lib/db/schema";
import { GET, POST } from "@/app/api/ingredients/route";

async function seedFamily(clerkId = "user_test") {
  const [family] = await db.insert(families).values({ name: "Fam" }).returning();
  const [user] = await db
    .insert(users)
    .values({ clerkUserId: clerkId, email: `${clerkId}@x.com`, displayName: clerkId })
    .returning();
  await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });
  setMockClerkUser(clerkId);
  return { family: family!, user: user! };
}

const ctx = { params: Promise.resolve({}) };

beforeEach(async () => {
  await resetDb();
  setMockClerkUser(null);
});

describe("GET /api/ingredients", () => {
  it("returns 401 without a session", async () => {
    setMockClerkUser(null);
    const res = await GET(new Request("http://localhost/api/ingredients?q=on"), ctx);
    expect(res.status).toBe(401);
  });
  it("returns prefix-matching ingredients for the family", async () => {
    const { family } = await seedFamily();
    await db.insert(ingredients).values([
      { familyId: family.id, name: "Onion", category: "produce" },
      { familyId: family.id, name: "Orange", category: "produce" },
      { familyId: family.id, name: "Tomato", category: "produce" },
    ]);
    const res = await GET(new Request("http://localhost/api/ingredients?q=on"), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.map((i: { name: string }) => i.name).sort()).toEqual(["Onion"]);
  });
  it("does not leak ingredients across families", async () => {
    const a = await seedFamily("user_a");
    setMockClerkUser(null);
    const b = await seedFamily("user_b");
    await db.insert(ingredients).values({ familyId: a.family.id, name: "Onion", category: "produce" });
    setMockClerkUser("user_b");
    const res = await GET(new Request("http://localhost/api/ingredients?q=on"), ctx);
    const body = await res.json();
    expect(body.items).toEqual([]);
  });
  it("rejects q shorter than 1 char", async () => {
    await seedFamily();
    const res = await GET(new Request("http://localhost/api/ingredients?q="), ctx);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/ingredients", () => {
  it("creates an ingredient", async () => {
    const { family } = await seedFamily();
    const req = new Request("http://localhost/api/ingredients", {
      method: "POST",
      body: JSON.stringify({ name: "Carrot", category: "produce" }),
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Carrot");
    expect(body.familyId).toBeUndefined(); // not exposed in response shape
  });
  it("returns 409 on case-insensitive duplicate within family", async () => {
    const { family } = await seedFamily();
    await db.insert(ingredients).values({ familyId: family.id, name: "Onion", category: "produce" });
    const req = new Request("http://localhost/api/ingredients", {
      method: "POST",
      body: JSON.stringify({ name: "onion", category: "produce" }),
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail with import error**

```bash
pnpm test tests/integration/api-ingredients.test.ts
```

Expected: FAIL — can't resolve `@/app/api/ingredients/route`.

- [ ] **Step 3: Implement the route**

Create `src/app/api/ingredients/route.ts`:

```ts
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
    if (err instanceof Error && /ingredients_family_name_uniq/.test(err.message)) {
      throw new ConflictError("Ingredient with that name already exists");
    }
    throw err;
  }
});
```

`ConflictError`, `ValidationError`, `UnauthorizedError`, `NotFoundError`, and `ForbiddenError` already exist in `src/lib/auth/errors.ts` from Phase 0 — no changes to that file required.

- [ ] **Step 4: Run tests, confirm green**

```bash
pnpm test tests/integration/api-ingredients.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ingredients src/lib/auth/errors.ts tests/integration/api-ingredients.test.ts
git commit -m "feat(api): /api/ingredients GET + POST with conflict handling"
```

---

## Task 7: API — `/api/meals` GET list (TDD)

**Files:**
- Create: `src/app/api/meals/route.ts`, `tests/integration/api-meals.test.ts`

This task only covers the **GET handler**. POST goes in Task 9. We will append to the same file in later tasks.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/api-meals.test.ts` with the seed helper and the first describe block (GET list):

```ts
import { describe, it, expect, beforeEach } from "vitest";
import "../helpers/auth";
import { setMockClerkUser } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { db } from "@/lib/db/client";
import {
  families,
  users,
  familyUsers,
  meals,
  ingredients,
  mealIngredients,
} from "@/lib/db/schema";
import { GET } from "@/app/api/meals/route";

async function seedFamily(clerkId = "user_test") {
  const [family] = await db.insert(families).values({ name: "Fam" }).returning();
  const [user] = await db
    .insert(users)
    .values({ clerkUserId: clerkId, email: `${clerkId}@x.com`, displayName: clerkId })
    .returning();
  await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });
  setMockClerkUser(clerkId);
  return { family: family!, user: user! };
}

const ctx = { params: Promise.resolve({}) };

beforeEach(async () => {
  await resetDb();
  setMockClerkUser(null);
});

describe("GET /api/meals", () => {
  it("returns 401 without a session", async () => {
    setMockClerkUser(null);
    const res = await GET(new Request("http://localhost/api/meals"), ctx);
    expect(res.status).toBe(401);
  });
  it("returns the family's meals sorted by lower(name)", async () => {
    const { family } = await seedFamily();
    await db.insert(meals).values([
      { familyId: family.id, name: "Tacos", tags: ["mexican"] },
      { familyId: family.id, name: "Apple Pie", tags: ["dessert"] },
    ]);
    const res = await GET(new Request("http://localhost/api/meals"), ctx);
    const body = await res.json();
    expect(body.items.map((m: { name: string }) => m.name)).toEqual(["Apple Pie", "Tacos"]);
  });
  it("filters by q prefix (case-insensitive)", async () => {
    const { family } = await seedFamily();
    await db.insert(meals).values([
      { familyId: family.id, name: "Tacos" },
      { familyId: family.id, name: "Apple Pie" },
    ]);
    const res = await GET(new Request("http://localhost/api/meals?q=tac"), ctx);
    const body = await res.json();
    expect(body.items.map((m: { name: string }) => m.name)).toEqual(["Tacos"]);
  });
  it("filters by multiple tags (AND)", async () => {
    const { family } = await seedFamily();
    await db.insert(meals).values([
      { familyId: family.id, name: "A", tags: ["quick", "mexican"] },
      { familyId: family.id, name: "B", tags: ["quick"] },
      { familyId: family.id, name: "C", tags: ["mexican"] },
    ]);
    const res = await GET(
      new Request("http://localhost/api/meals?tag=quick&tag=mexican"),
      ctx,
    );
    const body = await res.json();
    expect(body.items.map((m: { name: string }) => m.name)).toEqual(["A"]);
  });
  it("hides archived meals by default", async () => {
    const { family } = await seedFamily();
    await db.insert(meals).values([
      { familyId: family.id, name: "Active" },
      { familyId: family.id, name: "Archived", isArchived: true },
    ]);
    const res = await GET(new Request("http://localhost/api/meals"), ctx);
    const body = await res.json();
    expect(body.items.map((m: { name: string }) => m.name)).toEqual(["Active"]);
  });
  it("does not leak meals across families", async () => {
    const a = await seedFamily("user_a");
    await db.insert(meals).values({ familyId: a.family.id, name: "A meal" });
    const b = await seedFamily("user_b");
    setMockClerkUser("user_b");
    const res = await GET(new Request("http://localhost/api/meals"), ctx);
    const body = await res.json();
    expect(body.items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
pnpm test tests/integration/api-meals.test.ts
```

Expected: FAIL — `@/app/api/meals/route` not found.

- [ ] **Step 3: Implement the GET handler**

Create `src/app/api/meals/route.ts`:

```ts
import { and, asc, eq, ilike, sql } from "drizzle-orm";
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
  if (tags.length > 0) conditions.push(sql`${meals.tags} @> ${tags}::text[]`);

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
```

- [ ] **Step 4: Run tests, confirm green**

```bash
pnpm test tests/integration/api-meals.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/meals/route.ts tests/integration/api-meals.test.ts
git commit -m "feat(api): GET /api/meals with q + tag filters"
```

---

## Task 8: API — `/api/meals/tags` (TDD)

**Files:**
- Create: `src/app/api/meals/tags/route.ts`
- Modify: `tests/integration/api-meals.test.ts`

- [ ] **Step 1: Append tests to `tests/integration/api-meals.test.ts`**

Append (do not replace) at the bottom of the file:

```ts
import { GET as TagsGET } from "@/app/api/meals/tags/route";

describe("GET /api/meals/tags", () => {
  it("returns deduplicated lowercase tags for the family", async () => {
    const { family } = await seedFamily();
    await db.insert(meals).values([
      { familyId: family.id, name: "A", tags: ["mexican", "quick"] },
      { familyId: family.id, name: "B", tags: ["dessert", "quick"] },
    ]);
    const res = await TagsGET(new Request("http://localhost/api/meals/tags"), ctx);
    const body = await res.json();
    expect(body.items.sort()).toEqual(["dessert", "mexican", "quick"]);
  });
  it("does not leak tags across families", async () => {
    const a = await seedFamily("user_a");
    await db.insert(meals).values({ familyId: a.family.id, name: "X", tags: ["fam-a"] });
    const b = await seedFamily("user_b");
    setMockClerkUser("user_b");
    const res = await TagsGET(new Request("http://localhost/api/meals/tags"), ctx);
    const body = await res.json();
    expect(body.items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
pnpm test tests/integration/api-meals.test.ts -t "GET /api/meals/tags"
```

Expected: FAIL — `@/app/api/meals/tags/route` not found.

- [ ] **Step 3: Implement**

Create `src/app/api/meals/tags/route.ts`:

```ts
import { eq, sql } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { withFamily } from "@/lib/auth/with-family";
import { db } from "@/lib/db/client";
import { meals } from "@/lib/db/schema";

export const GET = apiHandler(async () => {
  const { familyId } = await withFamily();
  const rows = await db
    .select({ tag: sql<string>`distinct unnest(${meals.tags})` })
    .from(meals)
    .where(eq(meals.familyId, familyId));
  const items = rows.map((r) => r.tag).sort();
  return { items };
});
```

- [ ] **Step 4: Run, confirm green**

```bash
pnpm test tests/integration/api-meals.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/meals/tags
git commit -m "feat(api): GET /api/meals/tags returns distinct family tags"
```

---

## Task 9: API — `/api/meals` POST create (TDD)

**Files:**
- Modify: `src/app/api/meals/route.ts`, `tests/integration/api-meals.test.ts`

- [ ] **Step 1: Append create tests**

Append to `tests/integration/api-meals.test.ts`:

```ts
import { POST } from "@/app/api/meals/route";

describe("POST /api/meals", () => {
  it("creates a meal with mixed structured + free-text ingredients", async () => {
    const { family } = await seedFamily();
    const [ing] = await db
      .insert(ingredients)
      .values({ familyId: family.id, name: "Beef", category: "meat" })
      .returning();
    const body = {
      name: "Tacos",
      instructions: "## Steps\n1. Cook",
      tags: ["mexican", "quick"],
      ingredients: [
        { ingredientId: ing!.id, quantity: 1, unit: "lb", sortOrder: 0 },
        { displayText: "a pinch of salt", sortOrder: 1 },
      ],
    };
    const res = await POST(
      new Request("http://localhost/api/meals", { method: "POST", body: JSON.stringify(body) }),
      ctx,
    );
    expect(res.status).toBe(200);
    const meal = await res.json();
    expect(meal.name).toBe("Tacos");
    expect(meal.tags.sort()).toEqual(["mexican", "quick"]);
    expect(meal.ingredients).toHaveLength(2);
    const structured = meal.ingredients.find((i: { ingredientId: string | null }) => i.ingredientId);
    expect(structured.ingredientName).toBe("Beef");
    expect(structured.quantity).toBe("1.000"); // numeric -> string
    const freeText = meal.ingredients.find(
      (i: { displayText: string | null }) => i.displayText,
    );
    expect(freeText.displayText).toBe("a pinch of salt");
  });
  it("rejects 422 when neither ingredientId nor displayText is set", async () => {
    await seedFamily();
    const res = await POST(
      new Request("http://localhost/api/meals", {
        method: "POST",
        body: JSON.stringify({ name: "X", ingredients: [{ sortOrder: 0 }] }),
      }),
      ctx,
    );
    expect(res.status).toBe(400);
  });
  it("normalizes tags on save (case + trim + dedupe)", async () => {
    await seedFamily();
    const res = await POST(
      new Request("http://localhost/api/meals", {
        method: "POST",
        body: JSON.stringify({ name: "X", tags: [" Quick ", "QUICK", "Dessert"] }),
      }),
      ctx,
    );
    const body = await res.json();
    expect(body.tags.sort()).toEqual(["dessert", "quick"]);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Expected: FAIL — `POST` is not exported from the route module yet.

- [ ] **Step 3: Append POST to the route**

Append to `src/app/api/meals/route.ts` (keep the existing GET):

```ts
import { ValidationError } from "@/lib/auth/errors";
import { mealIngredients, ingredients } from "@/lib/db/schema";
import { MealCreateSchema } from "@/lib/validation/meal";
import { inArray } from "drizzle-orm";

async function fetchMealDetail(mealId: string, familyId: string) {
  const [meal] = await db
    .select()
    .from(meals)
    .where(and(eq(meals.id, mealId), eq(meals.familyId, familyId)))
    .limit(1);
  if (!meal) return null;

  const ingRows = await db
    .select({
      id: mealIngredients.id,
      ingredientId: mealIngredients.ingredientId,
      displayText: mealIngredients.displayText,
      quantity: mealIngredients.quantity,
      unit: mealIngredients.unit,
      sortOrder: mealIngredients.sortOrder,
      ingredientName: ingredients.name,
    })
    .from(mealIngredients)
    .leftJoin(ingredients, eq(mealIngredients.ingredientId, ingredients.id))
    .where(eq(mealIngredients.mealId, mealId))
    .orderBy(asc(mealIngredients.sortOrder));

  return {
    id: meal.id,
    name: meal.name,
    description: meal.description,
    instructions: meal.instructions,
    prepTimeMinutes: meal.prepTimeMinutes,
    cookTimeMinutes: meal.cookTimeMinutes,
    servings: meal.servings,
    sourceUrl: meal.sourceUrl,
    tags: meal.tags,
    updatedAt: meal.updatedAt,
    ingredients: ingRows,
  };
}

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
```

- [ ] **Step 4: Run tests, confirm green**

```bash
pnpm test tests/integration/api-meals.test.ts
```

Expected: PASS for the create suite plus all earlier suites.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/meals/route.ts tests/integration/api-meals.test.ts
git commit -m "feat(api): POST /api/meals with transactional ingredient writes"
```

---

## Task 10: API — `/api/meals/[id]` GET detail (TDD)

**Files:**
- Create: `src/app/api/meals/[id]/route.ts`
- Modify: `tests/integration/api-meals.test.ts`

- [ ] **Step 1: Append tests**

Append to `tests/integration/api-meals.test.ts`:

```ts
import { GET as DetailGET } from "@/app/api/meals/[id]/route";

function detailCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/meals/[id]", () => {
  it("returns the meal with ingredient names joined", async () => {
    const { family } = await seedFamily();
    const [ing] = await db
      .insert(ingredients)
      .values({ familyId: family.id, name: "Beef", category: "meat" })
      .returning();
    const [m] = await db
      .insert(meals)
      .values({ familyId: family.id, name: "Tacos" })
      .returning();
    await db.insert(mealIngredients).values({
      mealId: m!.id,
      ingredientId: ing!.id,
      quantity: "1.500",
      unit: "lb",
      sortOrder: 0,
    });
    const res = await DetailGET(new Request("http://localhost"), detailCtx(m!.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Tacos");
    expect(body.ingredients[0].ingredientName).toBe("Beef");
  });
  it("returns 404 for a meal in another family", async () => {
    const a = await seedFamily("user_a");
    const [m] = await db
      .insert(meals)
      .values({ familyId: a.family.id, name: "Cross" })
      .returning();
    const b = await seedFamily("user_b");
    setMockClerkUser("user_b");
    const res = await DetailGET(new Request("http://localhost"), detailCtx(m!.id));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Expected: FAIL — route module missing.

- [ ] **Step 3: Implement**

Create `src/app/api/meals/[id]/route.ts`:

```ts
import { and, asc, eq } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { withFamily } from "@/lib/auth/with-family";
import { NotFoundError } from "@/lib/auth/errors";
import { db } from "@/lib/db/client";
import { meals, mealIngredients, ingredients } from "@/lib/db/schema";

type RouteCtx = { params: Promise<{ id: string }> };

async function fetchMealDetail(mealId: string, familyId: string) {
  const [meal] = await db
    .select()
    .from(meals)
    .where(and(eq(meals.id, mealId), eq(meals.familyId, familyId)))
    .limit(1);
  if (!meal) return null;
  const ingRows = await db
    .select({
      id: mealIngredients.id,
      ingredientId: mealIngredients.ingredientId,
      displayText: mealIngredients.displayText,
      quantity: mealIngredients.quantity,
      unit: mealIngredients.unit,
      sortOrder: mealIngredients.sortOrder,
      ingredientName: ingredients.name,
    })
    .from(mealIngredients)
    .leftJoin(ingredients, eq(mealIngredients.ingredientId, ingredients.id))
    .where(eq(mealIngredients.mealId, mealId))
    .orderBy(asc(mealIngredients.sortOrder));
  return {
    id: meal.id,
    name: meal.name,
    description: meal.description,
    instructions: meal.instructions,
    prepTimeMinutes: meal.prepTimeMinutes,
    cookTimeMinutes: meal.cookTimeMinutes,
    servings: meal.servings,
    sourceUrl: meal.sourceUrl,
    tags: meal.tags,
    updatedAt: meal.updatedAt,
    ingredients: ingRows,
  };
}

export const GET = apiHandler<RouteCtx>(async (_req, ctx) => {
  const { familyId } = await withFamily();
  const { id } = await ctx.params;
  const detail = await fetchMealDetail(id, familyId);
  if (!detail) throw new NotFoundError("Meal not found");
  return detail;
});
```

The duplication of `fetchMealDetail` between `/api/meals/route.ts` and `/api/meals/[id]/route.ts` is intentional in TDD — Task 11 will extract a shared helper once we know all consumers. **Do not pre-extract.**

- [ ] **Step 4: Run, confirm green**

```bash
pnpm test tests/integration/api-meals.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/meals/[id]/route.ts tests/integration/api-meals.test.ts
git commit -m "feat(api): GET /api/meals/[id] with joined ingredient names"
```

---

## Task 11: Extract shared `fetchMealDetail`; add PATCH + DELETE (TDD)

**Files:**
- Create: `src/app/api/meals/_meal-detail.ts`
- Modify: `src/app/api/meals/route.ts`, `src/app/api/meals/[id]/route.ts`, `tests/integration/api-meals.test.ts`

The leading underscore prefix tells Next.js not to treat the file as a route segment.

- [ ] **Step 1: Extract the shared helper**

Create `src/app/api/meals/_meal-detail.ts`:

```ts
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { meals, mealIngredients, ingredients } from "@/lib/db/schema";

export async function fetchMealDetail(mealId: string, familyId: string) {
  const [meal] = await db
    .select()
    .from(meals)
    .where(and(eq(meals.id, mealId), eq(meals.familyId, familyId)))
    .limit(1);
  if (!meal) return null;
  const ingRows = await db
    .select({
      id: mealIngredients.id,
      ingredientId: mealIngredients.ingredientId,
      displayText: mealIngredients.displayText,
      quantity: mealIngredients.quantity,
      unit: mealIngredients.unit,
      sortOrder: mealIngredients.sortOrder,
      ingredientName: ingredients.name,
    })
    .from(mealIngredients)
    .leftJoin(ingredients, eq(mealIngredients.ingredientId, ingredients.id))
    .where(eq(mealIngredients.mealId, mealId))
    .orderBy(asc(mealIngredients.sortOrder));
  return {
    id: meal.id,
    name: meal.name,
    description: meal.description,
    instructions: meal.instructions,
    prepTimeMinutes: meal.prepTimeMinutes,
    cookTimeMinutes: meal.cookTimeMinutes,
    servings: meal.servings,
    sourceUrl: meal.sourceUrl,
    tags: meal.tags,
    updatedAt: meal.updatedAt,
    ingredients: ingRows,
  };
}

export type MealDetail = NonNullable<Awaited<ReturnType<typeof fetchMealDetail>>>;
```

- [ ] **Step 2: Replace the duplicated copies**

In `src/app/api/meals/route.ts`, delete the local `fetchMealDetail` declaration and import `fetchMealDetail` from `./_meal-detail`. Same for `src/app/api/meals/[id]/route.ts`.

- [ ] **Step 3: Run all tests, confirm green**

```bash
pnpm test tests/integration/api-meals.test.ts
```

Expected: all PASS (no behavioral change).

- [ ] **Step 4: Add PATCH and DELETE tests**

Append to `tests/integration/api-meals.test.ts`:

```ts
import { PATCH, DELETE } from "@/app/api/meals/[id]/route";

describe("PATCH /api/meals/[id]", () => {
  it("replaces tags and ingredient rows", async () => {
    const { family } = await seedFamily();
    const [m] = await db
      .insert(meals)
      .values({ familyId: family.id, name: "Tacos", tags: ["old"] })
      .returning();
    await db.insert(mealIngredients).values({
      mealId: m!.id,
      displayText: "old item",
      sortOrder: 0,
    });
    const res = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          tags: ["mexican"],
          ingredients: [{ displayText: "new item", sortOrder: 0 }],
        }),
      }),
      detailCtx(m!.id),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tags).toEqual(["mexican"]);
    expect(body.ingredients).toHaveLength(1);
    expect(body.ingredients[0].displayText).toBe("new item");
  });
  it("returns 404 across families", async () => {
    const a = await seedFamily("user_a");
    const [m] = await db.insert(meals).values({ familyId: a.family.id, name: "X" }).returning();
    const b = await seedFamily("user_b");
    setMockClerkUser("user_b");
    const res = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ name: "Y" }),
      }),
      detailCtx(m!.id),
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/meals/[id]", () => {
  it("deletes the meal and its ingredient rows (cascade)", async () => {
    const { family } = await seedFamily();
    const [m] = await db.insert(meals).values({ familyId: family.id, name: "X" }).returning();
    await db.insert(mealIngredients).values({ mealId: m!.id, displayText: "x", sortOrder: 0 });
    const res = await DELETE(new Request("http://localhost"), detailCtx(m!.id));
    expect(res.status).toBe(204);
    const rows = await db.select().from(mealIngredients).where(eq(mealIngredients.mealId, m!.id));
    expect(rows).toEqual([]);
  });
  it("returns 404 across families", async () => {
    const a = await seedFamily("user_a");
    const [m] = await db.insert(meals).values({ familyId: a.family.id, name: "X" }).returning();
    const b = await seedFamily("user_b");
    setMockClerkUser("user_b");
    const res = await DELETE(new Request("http://localhost"), detailCtx(m!.id));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 5: Run, confirm failure**

Expected: FAIL — PATCH / DELETE not exported.

- [ ] **Step 6: Implement PATCH + DELETE**

Append to `src/app/api/meals/[id]/route.ts`:

```ts
import { ValidationError } from "@/lib/auth/errors";
import { MealUpdateSchema } from "@/lib/validation/meal";
import { mealIngredients } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

export const PATCH = apiHandler<RouteCtx>(async (req, ctx) => {
  const { familyId, userId } = await withFamily();
  const { id } = await ctx.params;

  // Verify the meal exists and belongs to this family before mutating
  const [existing] = await db
    .select({ id: meals.id })
    .from(meals)
    .where(and(eq(meals.id, id), eq(meals.familyId, familyId)))
    .limit(1);
  if (!existing) throw new NotFoundError("Meal not found");

  const json = await req.json();
  const parsed = MealUpdateSchema.safeParse(json);
  if (!parsed.success) {
    throw new ValidationError("Invalid meal payload", parsed.error.flatten());
  }

  // Validate referenced ingredient IDs belong to the family
  const newIngredientIds = (parsed.data.ingredients ?? [])
    .map((r) => r.ingredientId)
    .filter((v): v is string => Boolean(v));
  if (newIngredientIds.length > 0) {
    const owned = await db
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(and(eq(ingredients.familyId, familyId), inArray(ingredients.id, newIngredientIds)));
    if (owned.length !== new Set(newIngredientIds).size) {
      throw new ValidationError("One or more ingredient IDs are invalid");
    }
  }

  await db.transaction(async (tx) => {
    const updates: Record<string, unknown> = {
      updatedByUserId: userId,
      updatedAt: new Date(),
    };
    for (const k of [
      "name",
      "description",
      "instructions",
      "prepTimeMinutes",
      "cookTimeMinutes",
      "servings",
      "sourceUrl",
      "tags",
    ] as const) {
      if (parsed.data[k] !== undefined) updates[k] = parsed.data[k];
    }
    await tx.update(meals).set(updates).where(eq(meals.id, id));

    if (parsed.data.ingredients !== undefined) {
      await tx.delete(mealIngredients).where(eq(mealIngredients.mealId, id));
      if (parsed.data.ingredients.length > 0) {
        await tx.insert(mealIngredients).values(
          parsed.data.ingredients.map((r) => ({
            mealId: id,
            ingredientId: r.ingredientId ?? null,
            displayText: r.displayText ?? null,
            quantity: r.quantity != null ? String(r.quantity) : null,
            unit: r.unit ?? null,
            sortOrder: r.sortOrder,
          })),
        );
      }
    }
  });

  const detail = await fetchMealDetail(id, familyId);
  if (!detail) throw new NotFoundError("Meal not found after update"); // shouldn't happen
  return detail;
});

export const DELETE = apiHandler<RouteCtx>(async (_req, ctx) => {
  const { familyId } = await withFamily();
  const { id } = await ctx.params;
  const result = await db
    .delete(meals)
    .where(and(eq(meals.id, id), eq(meals.familyId, familyId)))
    .returning({ id: meals.id });
  if (result.length === 0) throw new NotFoundError("Meal not found");
  return undefined; // 204 via apiHandler
});
```

- [ ] **Step 7: Run, confirm green**

```bash
pnpm test tests/integration/api-meals.test.ts
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/meals tests/integration/api-meals.test.ts
git commit -m "feat(api): PATCH + DELETE /api/meals/[id] with delete-and-reinsert ingredient strategy"
```

---

## Task 12: Markdown view and editor components

**Files:**
- Create: `src/components/markdown-view.tsx`, `src/components/markdown-editor.tsx`

- [ ] **Step 1: Markdown view (read-only)**

Create `src/components/markdown-view.tsx`:

```tsx
"use client";

import ReactMarkdown from "react-markdown";

export function MarkdownView({ source }: { source: string | null | undefined }) {
  if (!source || source.trim().length === 0) {
    return <p className="text-muted-foreground text-sm">No instructions yet.</p>;
  }
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown>{source}</ReactMarkdown>
    </div>
  );
}
```

If the repo's Tailwind config doesn't include `@tailwindcss/typography`, the `prose` classes are no-ops — that's fine. The plugin can be added later as a polish task.

- [ ] **Step 2: Markdown editor with tabs**

Create `src/components/markdown-editor.tsx`:

```tsx
"use client";

import { useState } from "react";
import { MarkdownView } from "./markdown-view";

export interface MarkdownEditorProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder = "Write instructions in Markdown…",
  rows = 12,
  maxLength = 20_000,
}: MarkdownEditorProps) {
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  return (
    <div className="flex flex-col gap-2">
      <div className="inline-flex gap-1 rounded-md border bg-muted/30 p-0.5 self-start">
        <button
          type="button"
          onClick={() => setTab("edit")}
          className={
            "rounded px-2 py-1 text-xs " +
            (tab === "edit" ? "bg-background shadow-sm" : "text-muted-foreground")
          }
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => setTab("preview")}
          className={
            "rounded px-2 py-1 text-xs " +
            (tab === "preview" ? "bg-background shadow-sm" : "text-muted-foreground")
          }
        >
          Preview
        </button>
      </div>
      {tab === "edit" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          maxLength={maxLength}
          className="w-full rounded-md border bg-background p-2 font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : (
        <div className="rounded-md border bg-background p-3 min-h-[10rem]">
          <MarkdownView source={value} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/markdown-view.tsx src/components/markdown-editor.tsx
git commit -m "feat(ui): markdown view + edit/preview tabbed editor"
```

---

## Task 13: Tag input component

**Files:**
- Create: `src/components/tag-input.tsx`

- [ ] **Step 1: Implement**

Create `src/components/tag-input.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api } from "@/lib/http/fetcher";

export interface TagInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  max?: number;
}

const norm = (s: string) => s.trim().toLowerCase();

export function TagInput({ value, onChange, max = 10 }: TagInputProps) {
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      api<{ items: string[] }>("/api/meals/tags")
        .then((r) => setSuggestions(r.items))
        .catch(() => setSuggestions([]));
    }
  }, []);

  function commit(raw: string) {
    const t = norm(raw);
    if (!t || t.length > 30) return;
    if (value.includes(t)) return;
    if (value.length >= max) return;
    onChange([...value, t]);
    setInput("");
    setOpen(false);
  }

  function remove(t: string) {
    onChange(value.filter((x) => x !== t));
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(input);
    } else if (e.key === "Backspace" && input.length === 0 && value.length > 0) {
      remove(value[value.length - 1]!);
    }
  }

  const filtered = input
    ? suggestions.filter(
        (s) => s.startsWith(norm(input)) && !value.includes(s),
      )
    : [];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5 rounded-md border bg-background p-1.5">
        {value.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs"
          >
            {t}
            <button
              type="button"
              onClick={() => remove(t)}
              aria-label={`Remove ${t}`}
              className="text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 100)}
          onKeyDown={onKey}
          placeholder={value.length === 0 ? "Add tag (press Enter)" : ""}
          className="flex-1 min-w-[8ch] bg-transparent text-sm focus:outline-none"
        />
      </div>
      {open && filtered.length > 0 ? (
        <ul className="rounded-md border bg-popover p-1 text-sm shadow-md">
          {filtered.slice(0, 8).map((s) => (
            <li key={s}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(s)}
                className="w-full rounded px-2 py-1 text-left hover:bg-muted"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/tag-input.tsx
git commit -m "feat(ui): tag-input with autocomplete from /api/meals/tags"
```

---

## Task 14: Ingredient combobox (autocomplete + create-new)

**Files:**
- Create: `src/components/ingredient-combobox.tsx`

- [ ] **Step 1: Implement**

Create `src/components/ingredient-combobox.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/http/fetcher";
import type { IngredientCategory } from "@/lib/validation/ingredient";

export interface IngredientChoice {
  id: string;
  name: string;
}

interface ApiIngredient extends IngredientChoice {
  defaultUnit: string | null;
  category: IngredientCategory;
}

export interface IngredientComboboxProps {
  value: IngredientChoice | null;        // null when row uses displayText only
  freeText: string;                       // displayText draft
  onChooseIngredient: (i: IngredientChoice) => void;
  onChangeFreeText: (s: string) => void;
  onCreated?: (i: ApiIngredient) => void;
}

export function IngredientCombobox({
  value,
  freeText,
  onChooseIngredient,
  onChangeFreeText,
  onCreated,
}: IngredientComboboxProps) {
  const [query, setQuery] = useState(value?.name ?? freeText ?? "");
  const [results, setResults] = useState<ApiIngredient[]>([]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 1) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await api<{ items: ApiIngredient[] }>(
          `/api/ingredients?q=${encodeURIComponent(query)}`,
        );
        setResults(r.items);
      } catch {
        setResults([]);
      }
    }, 200);
  }, [query]);

  async function createNew() {
    setCreating(true);
    try {
      const created = await api<ApiIngredient>("/api/ingredients", {
        method: "POST",
        body: JSON.stringify({ name: query, category: "other" }),
      });
      onChooseIngredient({ id: created.id, name: created.name });
      onCreated?.(created);
      setOpen(false);
    } finally {
      setCreating(false);
    }
  }

  const exactMatch = results.find(
    (r) => r.name.toLowerCase() === query.trim().toLowerCase(),
  );
  const canCreate = query.trim().length > 0 && !exactMatch;

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          onChangeFreeText(e.target.value);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder="Ingredient or free text"
        className="w-full rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {open ? (
        <ul className="absolute z-10 mt-1 w-full rounded-md border bg-popover p-1 text-sm shadow-md max-h-64 overflow-auto">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChooseIngredient({ id: r.id, name: r.name });
                  setQuery(r.name);
                  setOpen(false);
                }}
                className="w-full rounded px-2 py-1 text-left hover:bg-muted"
              >
                <span>{r.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{r.category}</span>
              </button>
            </li>
          ))}
          {canCreate ? (
            <li>
              <button
                type="button"
                disabled={creating}
                onMouseDown={(e) => e.preventDefault()}
                onClick={createNew}
                className="w-full rounded px-2 py-1 text-left text-primary hover:bg-muted"
              >
                {creating ? "Creating…" : `Create new ingredient "${query.trim()}"`}
              </button>
            </li>
          ) : null}
          {results.length === 0 && !canCreate ? (
            <li className="px-2 py-1 text-xs text-muted-foreground">No matches.</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/ingredient-combobox.tsx
git commit -m "feat(ui): ingredient combobox with autocomplete + create-new"
```

---

## Task 15: Meal ingredient row with drag-to-reorder

**Files:**
- Create: `src/components/meal-ingredient-row.tsx`

- [ ] **Step 1: Implement**

Create `src/components/meal-ingredient-row.tsx`:

```tsx
"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { IngredientCombobox, type IngredientChoice } from "./ingredient-combobox";

export interface IngredientRowValue {
  rowId: string;                           // client-only stable key
  ingredient: IngredientChoice | null;
  displayText: string;
  quantity: number | "";
  unit: string;
}

export interface MealIngredientRowProps {
  row: IngredientRowValue;
  onChange: (next: IngredientRowValue) => void;
  onRemove: () => void;
}

export function MealIngredientRow({ row, onChange, onRemove }: MealIngredientRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.rowId });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-2 rounded-md border bg-background p-2"
    >
      <button
        type="button"
        aria-label="Drag handle"
        className="cursor-grab select-none px-1 text-muted-foreground"
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <div className="flex flex-1 flex-col gap-1.5">
        <IngredientCombobox
          value={row.ingredient}
          freeText={row.displayText}
          onChooseIngredient={(ing) =>
            onChange({ ...row, ingredient: ing, displayText: "" })
          }
          onChangeFreeText={(s) =>
            onChange({ ...row, ingredient: null, displayText: s })
          }
        />
        <div className="flex gap-2">
          <input
            type="number"
            min={0}
            step="0.001"
            value={row.quantity}
            onChange={(e) =>
              onChange({
                ...row,
                quantity: e.target.value === "" ? "" : Number(e.target.value),
              })
            }
            placeholder="Qty"
            className="w-20 rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <input
            value={row.unit}
            onChange={(e) => onChange({ ...row, unit: e.target.value })}
            placeholder="Unit"
            maxLength={30}
            className="w-24 rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove ingredient"
        className="text-muted-foreground hover:text-destructive"
      >
        ×
      </button>
    </li>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/meal-ingredient-row.tsx
git commit -m "feat(ui): meal-ingredient-row with dnd-kit drag handle"
```

---

## Task 16: Meal form (compose all sub-components)

**Files:**
- Create: `src/components/meal-form.tsx`

- [ ] **Step 1: Implement**

Create `src/components/meal-form.tsx`:

```tsx
"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ClientApiError } from "@/lib/http/fetcher";
import { MarkdownEditor } from "./markdown-editor";
import { TagInput } from "./tag-input";
import {
  MealIngredientRow,
  type IngredientRowValue,
} from "./meal-ingredient-row";

export interface MealFormInitial {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  servings: number | null;
  sourceUrl: string | null;
  tags: string[];
  ingredients: Array<{
    ingredientId: string | null;
    ingredientName: string | null;
    displayText: string | null;
    quantity: string | null;     // numeric from DB serializes as string
    unit: string | null;
    sortOrder: number;
  }>;
}

let rowCounter = 0;
const nextRowId = () => `row_${++rowCounter}`;

function initRows(initial?: MealFormInitial): IngredientRowValue[] {
  if (!initial) return [];
  return initial.ingredients
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => ({
      rowId: nextRowId(),
      ingredient:
        r.ingredientId && r.ingredientName
          ? { id: r.ingredientId, name: r.ingredientName }
          : null,
      displayText: r.displayText ?? "",
      quantity: r.quantity != null ? Number(r.quantity) : "",
      unit: r.unit ?? "",
    }));
}

export function MealForm({ initial }: { initial?: MealFormInitial }) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const [prep, setPrep] = useState<number | "">(initial?.prepTimeMinutes ?? "");
  const [cook, setCook] = useState<number | "">(initial?.cookTimeMinutes ?? "");
  const [servings, setServings] = useState<number | "">(initial?.servings ?? "");
  const [sourceUrl, setSourceUrl] = useState(initial?.sourceUrl ?? "");
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [rows, setRows] = useState<IngredientRowValue[]>(() => initRows(initial));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function addRow() {
    setRows((rs) => [
      ...rs,
      { rowId: nextRowId(), ingredient: null, displayText: "", quantity: "", unit: "" },
    ]);
  }

  function updateRow(rowId: string, next: IngredientRowValue) {
    setRows((rs) => rs.map((r) => (r.rowId === rowId ? next : r)));
  }
  function removeRow(rowId: string) {
    setRows((rs) => rs.filter((r) => r.rowId !== rowId));
  }
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setRows((rs) => {
      const from = rs.findIndex((r) => r.rowId === active.id);
      const to = rs.findIndex((r) => r.rowId === over.id);
      return arrayMove(rs, from, to);
    });
  }

  const ids = useMemo(() => rows.map((r) => r.rowId), [rows]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        instructions: instructions.trim() || undefined,
        prepTimeMinutes: prep === "" ? undefined : prep,
        cookTimeMinutes: cook === "" ? undefined : cook,
        servings: servings === "" ? undefined : servings,
        sourceUrl: sourceUrl.trim() || undefined,
        tags,
        ingredients: rows.map((r, idx) => ({
          ingredientId: r.ingredient?.id ?? null,
          displayText: r.ingredient ? null : r.displayText.trim() || null,
          quantity: r.quantity === "" ? null : r.quantity,
          unit: r.unit.trim() || null,
          sortOrder: idx,
        })),
      };
      const saved = initial?.id
        ? await api<{ id: string }>(`/api/meals/${initial.id}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          })
        : await api<{ id: string }>("/api/meals", {
            method: "POST",
            body: JSON.stringify(payload),
          });
      router.push(`/app/meals/${saved.id}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ClientApiError) setError(err.message);
      else setError("Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!initial?.id) return;
    if (!confirm("Delete this recipe? This cannot be undone.")) return;
    setBusy(true);
    try {
      await api(`/api/meals/${initial.id}`, { method: "DELETE" });
      router.push("/app/meals");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="description">Description</Label>
          <Input
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prep">Prep (min)</Label>
            <Input
              id="prep"
              type="number"
              min={0}
              max={999}
              value={prep}
              onChange={(e) => setPrep(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cook">Cook (min)</Label>
            <Input
              id="cook"
              type="number"
              min={0}
              max={999}
              value={cook}
              onChange={(e) => setCook(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="servings">Servings</Label>
            <Input
              id="servings"
              type="number"
              min={1}
              max={99}
              value={servings}
              onChange={(e) => setServings(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sourceUrl">Source URL</Label>
          <Input
            id="sourceUrl"
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            maxLength={500}
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <Label>Ingredients</Label>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col gap-2">
              {rows.map((r) => (
                <MealIngredientRow
                  key={r.rowId}
                  row={r}
                  onChange={(next) => updateRow(r.rowId, next)}
                  onRemove={() => removeRow(r.rowId)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        <Button type="button" variant="ghost" onClick={addRow} className="self-start">
          Add ingredient
        </Button>
      </section>

      <section className="flex flex-col gap-1.5">
        <Label>Instructions</Label>
        <MarkdownEditor value={instructions} onChange={setInstructions} />
      </section>

      <section className="flex flex-col gap-1.5">
        <Label>Tags</Label>
        <TagInput value={tags} onChange={setTags} />
      </section>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {initial?.id ? "Save" : "Create recipe"}
        </Button>
        {initial?.id ? (
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={busy}
          >
            Delete
          </Button>
        ) : null}
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/meal-form.tsx
git commit -m "feat(ui): meal-form composing ingredient rows, markdown editor, tags"
```

---

## Task 17: Meal list + list item + filter controls

**Files:**
- Create: `src/components/meal-list-item.tsx`, `src/components/meal-list.tsx`

- [ ] **Step 1: List item**

Create `src/components/meal-list-item.tsx`:

```tsx
import Link from "next/link";
import { Card } from "@/components/ui/card";

export interface MealSummary {
  id: string;
  name: string;
  tags: string[];
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  servings: number | null;
}

export function MealListItem({ meal }: { meal: MealSummary }) {
  const total =
    (meal.prepTimeMinutes ?? 0) + (meal.cookTimeMinutes ?? 0) || null;
  return (
    <li>
      <Link href={`/app/meals/${meal.id}`} className="block">
        <Card className="flex flex-row items-start gap-3 p-3">
          <div className="flex flex-1 flex-col gap-1">
            <div className="font-medium">{meal.name}</div>
            <div className="text-xs text-muted-foreground">
              {total ? `${total} min` : "—"}
              {meal.servings ? ` · ${meal.servings} servings` : ""}
            </div>
            {meal.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {meal.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                  >
                    {t}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </Card>
      </Link>
    </li>
  );
}
```

- [ ] **Step 2: List (client island with filter controls)**

Create `src/components/meal-list.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/http/fetcher";
import { MealListItem, type MealSummary } from "./meal-list-item";

export interface MealListProps {
  initialItems: MealSummary[];
  initialQuery: string;
  initialTags: string[];
}

export function MealList({ initialItems, initialQuery, initialTags }: MealListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState(initialQuery);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [allTags, setAllTags] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api<{ items: string[] }>("/api/meals/tags")
      .then((r) => setAllTags(r.items))
      .catch(() => setAllTags([]));
  }, []);

  function pushUrl(nextQ: string, nextTags: string[]) {
    const sp = new URLSearchParams();
    if (nextQ) sp.set("q", nextQ);
    for (const t of nextTags) sp.append("tag", t);
    const qs = sp.toString();
    startTransition(() =>
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }),
    );
  }

  function onQChange(v: string) {
    setQ(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => pushUrl(v, tags), 200);
  }

  function toggleTag(t: string) {
    const next = tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t];
    setTags(next);
    pushUrl(q, next);
  }

  function clearAll() {
    setQ("");
    setTags([]);
    pushUrl("", []);
  }

  const hasFilters = q.length > 0 || tags.length > 0;
  const items = initialItems;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Recipes</h2>
        <Link href="/app/meals/new" className={buttonVariants()}>
          New recipe
        </Link>
      </div>

      <Input
        placeholder="Search by name…"
        value={q}
        onChange={(e) => onQChange(e.target.value)}
      />

      {allTags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {allTags.map((t) => {
            const on = tags.includes(t);
            return (
              <button
                type="button"
                key={t}
                onClick={() => toggleTag(t)}
                className={
                  "rounded-full border px-2 py-0.5 text-xs " +
                  (on
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-background text-muted-foreground hover:text-foreground")
                }
              >
                {t}
              </button>
            );
          })}
        </div>
      ) : null}

      {items.length === 0 ? (
        hasFilters ? (
          <div className="rounded-md border bg-card p-6 text-sm">
            No recipes match.{" "}
            <button type="button" onClick={clearAll} className="underline">
              Clear filters
            </button>
          </div>
        ) : (
          <div className="rounded-md border bg-card p-6 text-center">
            <p className="mb-3">Build your first recipe.</p>
            <Link href="/app/meals/new" className={buttonVariants()}>
              New recipe
            </Link>
          </div>
        )
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((m) => (
            <MealListItem key={m.id} meal={m} />
          ))}
        </ul>
      )}
    </div>
  );
}
```

Filter state is held in component state; the URL is the source of truth across navigations (it's read by the server component in Task 18 before passing `initialQuery` / `initialTags`).

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/meal-list.tsx src/components/meal-list-item.tsx
git commit -m "feat(ui): meal list with URL-driven search + tag filter"
```

---

## Task 18: Pages and nav link

**Files:**
- Create: `src/app/app/meals/page.tsx`, `src/app/app/meals/new/page.tsx`, `src/app/app/meals/[id]/page.tsx`, `src/app/app/meals/[id]/edit/page.tsx`
- Modify: `src/app/app/layout.tsx`

- [ ] **Step 1: List page (RSC)**

Create `src/app/app/meals/page.tsx`:

```tsx
import { and, asc, eq, ilike, sql } from "drizzle-orm";
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
  if (tags.length > 0) conditions.push(sql`${meals.tags} @> ${tags}::text[]`);

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
```

- [ ] **Step 2: New page**

Create `src/app/app/meals/new/page.tsx`:

```tsx
import { MealForm } from "@/components/meal-form";

export default function NewMealPage() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">New recipe</h2>
      <MealForm />
    </div>
  );
}
```

- [ ] **Step 3: Detail page**

Create `src/app/app/meals/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { withFamily } from "@/lib/auth/with-family";
import { fetchMealDetail } from "@/app/api/meals/_meal-detail";
import { buttonVariants } from "@/components/ui/button";
import { MarkdownView } from "@/components/markdown-view";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MealDetailPage({ params }: PageProps) {
  const { familyId } = await withFamily();
  const { id } = await params;
  const meal = await fetchMealDetail(id, familyId);
  if (!meal) notFound();

  const total =
    (meal.prepTimeMinutes ?? 0) + (meal.cookTimeMinutes ?? 0) || null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold">{meal.name}</h2>
          {meal.description ? (
            <p className="text-muted-foreground">{meal.description}</p>
          ) : null}
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {total ? <span>{total} min total</span> : null}
            {meal.servings ? <span>· {meal.servings} servings</span> : null}
            {meal.sourceUrl ? (
              <a
                href={meal.sourceUrl}
                target="_blank"
                rel="noopener"
                className="underline"
              >
                Source ↗
              </a>
            ) : null}
          </div>
          {meal.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1 pt-1">
              {meal.tags.map((t) => (
                <span
                  key={t}
                  className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <Link
          href={`/app/meals/${meal.id}/edit`}
          className={buttonVariants({ variant: "outline" })}
        >
          Edit
        </Link>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-lg font-medium">Ingredients</h3>
        {meal.ingredients.length === 0 ? (
          <p className="text-sm text-muted-foreground">No ingredients yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {meal.ingredients.map((i) => (
              <li key={i.id} className="text-sm">
                <span className="text-muted-foreground">
                  {i.quantity ? `${i.quantity} ` : ""}
                  {i.unit ? `${i.unit} ` : ""}
                </span>
                <span>
                  {i.ingredientName ?? i.displayText}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-lg font-medium">Instructions</h3>
        <MarkdownView source={meal.instructions} />
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Edit page**

Create `src/app/app/meals/[id]/edit/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { withFamily } from "@/lib/auth/with-family";
import { fetchMealDetail } from "@/app/api/meals/_meal-detail";
import { MealForm, type MealFormInitial } from "@/components/meal-form";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditMealPage({ params }: PageProps) {
  const { familyId } = await withFamily();
  const { id } = await params;
  const meal = await fetchMealDetail(id, familyId);
  if (!meal) notFound();

  const initial: MealFormInitial = {
    id: meal.id,
    name: meal.name,
    description: meal.description,
    instructions: meal.instructions,
    prepTimeMinutes: meal.prepTimeMinutes,
    cookTimeMinutes: meal.cookTimeMinutes,
    servings: meal.servings,
    sourceUrl: meal.sourceUrl,
    tags: meal.tags,
    ingredients: meal.ingredients.map((i) => ({
      ingredientId: i.ingredientId,
      ingredientName: i.ingredientName,
      displayText: i.displayText,
      quantity: i.quantity,
      unit: i.unit,
      sortOrder: i.sortOrder,
    })),
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Edit recipe</h2>
      <MealForm initial={initial} />
    </div>
  );
}
```

- [ ] **Step 5: Add nav link**

Modify `src/app/app/layout.tsx`. Inside the `<nav>` element, add a "Recipes" link before "Profiles":

```tsx
<Link href="/app/meals" className="text-sm">Recipes</Link>
```

- [ ] **Step 6: Build**

```bash
pnpm build
```

Expected: clean build. Routes printed should now include `/app/meals`, `/app/meals/new`, `/app/meals/[id]`, `/app/meals/[id]/edit`, `/api/meals`, `/api/meals/[id]`, `/api/meals/tags`, `/api/ingredients`.

- [ ] **Step 7: Commit**

```bash
git add src/app/app/meals src/app/app/layout.tsx
git commit -m "feat(ui): recipe pages (list, new, detail, edit) + nav link"
```

---

## Task 19: E2E smoke extension

**Files:**
- Modify: `tests/e2e/smoke.spec.ts`

- [ ] **Step 1: Append a recipe-flow test**

Append to `tests/e2e/smoke.spec.ts` at the end of the describe block:

```ts
  test("authenticated user can create, search, filter, edit, and delete a recipe", async ({ page }) => {
    test.skip(
      !E2E_USER_EMAIL || !E2E_USER_PASSWORD,
      "Recipe flow requires E2E_USER_EMAIL + E2E_USER_PASSWORD",
    );
    await page.goto("/sign-in");
    await page.getByLabel(/email/i).fill(E2E_USER_EMAIL!);
    await page.getByRole("button", { name: /continue/i }).click();
    await page.getByLabel(/password/i).fill(E2E_USER_PASSWORD!);
    await page.getByRole("button", { name: /continue|sign in/i }).click();
    await page.waitForURL("**/app");

    // Create
    const unique = `Test Recipe ${Date.now()}`;
    await page.goto("/app/meals/new");
    await page.getByLabel("Name").fill(unique);
    await page.getByRole("button", { name: "Add ingredient" }).click();
    await page.getByPlaceholder("Ingredient or free text").fill("a pinch of salt");
    // Tag
    const tag = `e2etag${Date.now().toString(36)}`;
    await page.getByPlaceholder(/Add tag/).fill(tag);
    await page.getByPlaceholder(/Add tag/).press("Enter");
    await page.getByRole("button", { name: "Create recipe" }).click();
    await expect(page.getByRole("heading", { name: unique })).toBeVisible();

    // Search by name prefix
    await page.goto("/app/meals");
    await page.getByPlaceholder("Search by name…").fill(unique.slice(0, 6));
    await expect(page.getByRole("link", { name: new RegExp(unique) })).toBeVisible();

    // Filter by tag
    await page.getByPlaceholder("Search by name…").fill("");
    await page.getByRole("button", { name: tag }).click();
    await expect(page.getByRole("link", { name: new RegExp(unique) })).toBeVisible();

    // Edit
    await page.getByRole("link", { name: new RegExp(unique) }).click();
    await page.getByRole("link", { name: "Edit" }).click();
    await page.getByLabel("Name").fill(`${unique} (edited)`);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { name: `${unique} (edited)` })).toBeVisible();

    // Delete
    page.once("dialog", (d) => d.accept());
    await page.getByRole("link", { name: "Edit" }).click();
    await page.getByRole("button", { name: "Delete" }).click();
    await page.waitForURL("**/app/meals");
    await expect(page.getByText(new RegExp(unique))).toHaveCount(0);
  });
```

- [ ] **Step 2: Run E2E**

```bash
pnpm test:e2e
```

If `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` are not set in your shell, the new test will skip (alongside the auth one). To actually exercise it, export those env vars pointing to the seeded test user, then re-run.

Expected without credentials: 4 tests pass (landing, manifest on both projects), 4 tests skip (the two authenticated tests on both projects). No failures.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/smoke.spec.ts
git commit -m "test(e2e): cover recipe create/search/filter/edit/delete flow"
```

---

## Task 20: Final verification, deploy, smoke

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

```bash
pnpm typecheck && pnpm test && pnpm build
```

Expected:
- `typecheck` exits 0.
- `pnpm test` reports all Vitest suites passing (Phase 0 18 tests + new validation + new integration tests).
- `pnpm build` produces the new routes and the service worker.

- [ ] **Step 2: Local manual smoke**

```bash
pnpm dev
```

Open `http://localhost:3000/app/meals` after signing in. Manually verify:

- The list shows whatever you have (empty state if none) with a "New recipe" button.
- Create a recipe with one structured ingredient (using inline create) and one free-text ingredient. Save. Detail page renders Markdown.
- Return to the list. Search by prefix. Apply a tag filter. Clear filters.
- Edit the recipe — rename, add another ingredient, save. Detail reflects changes.
- Delete the recipe. Returns to the list.

Stop the dev server.

- [ ] **Step 3: Push to trigger Vercel deploy + CI**

```bash
git push
```

Expected:
- GitHub Actions CI runs the workflow and reports green.
- Vercel auto-deploys, `vercel-build` runs the new migration on the Neon preview branch (since this is a fresh deploy to main, it targets the production branch).
- The deploy goes Ready.

Watch with:

```bash
pnpm dlx vercel@latest ls
```

- [ ] **Step 4: Production smoke**

In a browser on the new production deploy URL, repeat the local smoke from Step 2 (sign in, create, search, edit, delete one recipe). If the recipe persists across reloads, the migration applied correctly.

- [ ] **Step 5: Tag the milestone**

```bash
git tag -a v0.2.0-recipe-library -m "Phase 1 — Recipe Library shipped"
git push --tags
```

(If you'd rather wait until a manual mobile install smoke per the overview's testing strategy, defer this step.)
