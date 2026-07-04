# Phase 3 Grocery List — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship materialized grocery lists derived from the schedule, with mixed manual add-ons, mobile "at the store" check-off, read-while-offline, and Background Sync for check-off writes. Sequential predecessor to Phase 4 (spend dashboard) but does not block it — Phase 4 reads `schedule_entries` directly.

**Architecture:** Two Drizzle tables (`grocery_lists`, `grocery_list_items`) with a partial unique index on derived structured items `(list_id, ingredient_id, COALESCE(unit,''))`. Pure helpers: `normalizeUnit` (canonical string map, no unit conversion), `generateDerivedItems` (bucketing algorithm over `schedule_entries` × `meal_ingredients`), `regenerateList` (drop-and-reinsert derived rows in one transaction, preserving check-off state where the aggregation key survives), `carryOverUnchecked` (copies unchecked source rows into target as manual). REST API mirrors phase 2's shape under `/api/grocery/*`. Client uses optimistic check-off; PWA runtime cache extends the Phase 0 config with SWR rules for `/app/grocery/*`, `/app/calendar`, `/app/meals/*`, plus a `workbox-background-sync` route for check-off PATCH.

**Tech Stack:** Next.js 16 (App Router, Turbopack dev / Webpack build), TypeScript, Drizzle ORM + Neon Postgres, Clerk auth, Zod validation, shadcn/ui + Tailwind v4, react-hook-form, date-fns, Vitest, Playwright, `@ducanh2912/next-pwa` (Workbox under the hood), `workbox-background-sync`.

**Source design spec:** [docs/superpowers/specs/2026-07-04-phase-3-grocery-list-design.md](../specs/2026-07-04-phase-3-grocery-list-design.md). Read this before starting.

**AGENTS.md callout:** `AGENTS.md` reads "This is NOT the Next.js you know" — when in doubt about a Next API (route handler signatures, dynamic route params, RSC vs client conventions), consult `node_modules/next/dist/docs/` before writing the code. Phase 0, 1, and 2 each hit drift bugs because of this.

---

## File map

### Created

```
drizzle/<NNNN>_<auto-name>.sql                   Generated migration

src/lib/units/normalize.ts                       normalizeUnit(raw)
src/lib/grocery/types.ts                         DerivedItem, GroceryListItemRow, IngredientCategory, INGREDIENT_CATEGORIES
src/lib/grocery/aggregate.ts                     generateDerivedItems(familyId, startDate, endDate)
src/lib/grocery/regenerate.ts                    regenerateList(listId, actorUserId)
src/lib/grocery/carry-over.ts                    carryOverUnchecked(fromListId, toListId, actorUserId)
src/lib/grocery/serialize.ts                     serializeList, serializeItem
src/lib/validation/grocery.ts                    Zod schemas + inferred types

src/app/api/grocery/lists/route.ts               GET list index, POST create+generate
src/app/api/grocery/lists/[id]/route.ts          GET, PATCH, DELETE
src/app/api/grocery/lists/[id]/regenerate/route.ts   POST
src/app/api/grocery/lists/[id]/items/route.ts    POST manual add
src/app/api/grocery/lists/[id]/items/[itemId]/route.ts   PATCH, DELETE
src/app/api/grocery/lists/[id]/carry-over/route.ts   POST

src/app/app/grocery/page.tsx                     RSC index
src/app/app/grocery/new/page.tsx                 RSC create form
src/app/app/grocery/[id]/page.tsx                RSC detail (at-the-store view)

src/components/grocery/grocery-list-index.tsx    Client island — lists cards + archive toggle
src/components/grocery/grocery-list-card.tsx     Single list card + action menu
src/components/grocery/grocery-list-form.tsx     Create form — react-hook-form + Zod
src/components/grocery/date-range-picker.tsx     Preset chips + custom range
src/components/grocery/grocery-list-view.tsx     Detail container — category sections
src/components/grocery/grocery-category-section.tsx  Collapsible category section
src/components/grocery/grocery-item-row.tsx      Row with optimistic check-off
src/components/grocery/manual-item-form.tsx      Add manual item, reuses IngredientCombobox
src/components/grocery/regenerate-button.tsx     Confirm dialog
src/components/grocery/carry-over-dialog.tsx     Target-list picker
src/components/grocery/offline-indicator.tsx     Online/offline + syncing banner

src/hooks/use-online-status.ts                   `navigator.onLine` subscription

tests/unit/units-normalize.test.ts               normalizeUnit alias/casing/passthrough
tests/unit/grocery-aggregate.test.ts             generateDerivedItems combos
tests/unit/grocery-regenerate.test.ts            regenerate preserves manual + matching check-off
tests/unit/grocery-carry-over.test.ts            unchecked → manual on target
tests/unit/validation-grocery.test.ts            Zod refinements
tests/integration/api-grocery-lists.test.ts      GET/POST index + PATCH/DELETE detail
tests/integration/api-grocery-regenerate.test.ts POST regenerate
tests/integration/api-grocery-items.test.ts      POST/PATCH/DELETE manual + check-off
tests/integration/api-grocery-carry-over.test.ts POST carry-over
```

### Modified

```
src/lib/db/schema.ts                             Add groceryLists + groceryListItems + inferred types
tests/helpers/db.ts                              resetDb drops groceryListItems + groceryLists first
next.config.ts                                   Expand runtimeCaching; add BackgroundSync for check-off PATCH
src/app/app/layout.tsx                           Add "Groceries" nav link between Calendar and Recipes
tests/e2e/smoke.spec.ts                          Add grocery-list flow (generate → check → regenerate → carry-over)
```

---

## Task 1: Schema — `grocery_lists` + `grocery_list_items` tables

**Files:**
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: Confirm existing imports are sufficient**

The schema file already imports `pgTable, pgEnum, uuid, text, timestamp, smallint, boolean, primaryKey, uniqueIndex, index, integer, numeric, date, check` from `drizzle-orm/pg-core`. No new imports needed.

- [ ] **Step 2: Append the two new tables at the end of `src/lib/db/schema.ts`, before the final `void sql;`**

```ts
export const groceryLists = pgTable(
  "grocery_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    lastRegeneratedAt: timestamp("last_regenerated_at", { withTimezone: true }),
    isArchived: boolean("is_archived").notNull().default(false),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    familyIdx: index("grocery_lists_family_idx").on(table.familyId),
    familyActiveIdx: index("grocery_lists_family_active_idx")
      .on(table.familyId)
      .where(sql`not ${table.isArchived}`),
    dateRangeCheck: check(
      "grocery_lists_date_range_check",
      sql`${table.endDate} >= ${table.startDate}`,
    ),
  }),
);

export const groceryListItems = pgTable(
  "grocery_list_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id")
      .notNull()
      .references(() => groceryLists.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id").references(() => ingredients.id, { onDelete: "set null" }),
    displayText: text("display_text"),
    quantity: numeric("quantity", { precision: 10, scale: 3 }),
    unit: text("unit"),
    category: text("category").notNull(),
    source: text("source").notNull(),
    checked: boolean("checked").notNull().default(false),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    checkedByUserId: uuid("checked_by_user_id").references(() => users.id, { onDelete: "set null" }),
    sourceScheduleEntryIds: uuid("source_schedule_entry_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    listIdx: index("grocery_list_items_list_idx").on(table.listId),
    derivedUniq: uniqueIndex("grocery_list_items_derived_uniq")
      .on(table.listId, table.ingredientId, sql`coalesce(${table.unit}, '')`)
      .where(sql`${table.source} = 'derived' and ${table.ingredientId} is not null`),
    sourceCheck: check(
      "grocery_list_items_source_check",
      sql`${table.source} in ('derived','manual')`,
    ),
    categoryCheck: check(
      "grocery_list_items_category_check",
      sql`${table.category} in ('produce','meat','dairy','pantry','frozen','bakery','other')`,
    ),
    displayOrIngredientCheck: check(
      "grocery_list_items_display_or_ingredient",
      sql`${table.ingredientId} is not null or ${table.displayText} is not null`,
    ),
    checkedAtConsistencyCheck: check(
      "grocery_list_items_checked_at_consistency",
      sql`(${table.checked} and ${table.checkedAt} is not null) or (not ${table.checked} and ${table.checkedAt} is null)`,
    ),
  }),
);

export type GroceryList = typeof groceryLists.$inferSelect;
export type NewGroceryList = typeof groceryLists.$inferInsert;
export type GroceryListItem = typeof groceryListItems.$inferSelect;
export type NewGroceryListItem = typeof groceryListItems.$inferInsert;
```

- [ ] **Step 3: Generate the migration**

```bash
pnpm db:generate
```

Expected: a new `drizzle/<NNNN>_<auto-name>.sql` file with `CREATE TABLE grocery_lists`, `CREATE TABLE grocery_list_items`, both `CREATE INDEX` statements for `grocery_lists`, `grocery_list_items_list_idx`, the partial unique index including `WHERE "source" = 'derived' AND "ingredient_id" IS NOT NULL`, and all four CHECK constraints.

- [ ] **Step 4: Open the migration file and verify the partial unique index survived**

Confirm the emitted SQL for `grocery_list_items_derived_uniq` includes `coalesce("unit", '')` in the key list and the `WHERE` predicate. If Drizzle stripped either, edit the SQL by hand — the spec REQUIRES both.

- [ ] **Step 5: Apply the migration locally**

```bash
pnpm db:migrate
```

Expected: migration applies cleanly against the local `mealplan` DB.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts drizzle/
git commit -m "feat(db): grocery_lists + grocery_list_items tables"
```

---

## Task 2: Update `resetDb()` test helper

**Files:**
- Modify: `tests/helpers/db.ts`

`grocery_list_items` cascades from `grocery_lists`, but both must be deleted before `families`, `ingredients`, and `users` due to their FKs.

- [ ] **Step 1: Replace `tests/helpers/db.ts` with:**

```ts
import { db } from "@/lib/db/client";
import {
  groceryListItems,
  groceryLists,
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
  await db.delete(groceryListItems);
  await db.delete(groceryLists);
  await db.delete(scheduleEntries);
  await db.delete(mealIngredients);
  await db.delete(meals);
  await db.delete(ingredients);
  await db.delete(profiles);
  await db.delete(familyUsers);
  await db.delete(users);
  await db.delete(families);
}
```

- [ ] **Step 2: Run the existing test suite to confirm no regressions**

```bash
pnpm test
```

Expected: all existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/helpers/db.ts
git commit -m "test(helpers): resetDb covers grocery_lists"
```

---

## Task 3: `normalizeUnit()` — canonical unit alias map

**Files:**
- Create: `src/lib/units/normalize.ts`
- Create: `tests/unit/units-normalize.test.ts`

Pure string function, no I/O. The alias map is the spec's §7 verbatim.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/units-normalize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeUnit } from "@/lib/units/normalize";

describe("normalizeUnit", () => {
  it("returns null for null and empty string", () => {
    expect(normalizeUnit(null)).toBeNull();
    expect(normalizeUnit("")).toBeNull();
    expect(normalizeUnit("   ")).toBeNull();
  });

  it("collapses teaspoon variants to tsp", () => {
    expect(normalizeUnit("teaspoon")).toBe("tsp");
    expect(normalizeUnit("teaspoons")).toBe("tsp");
    expect(normalizeUnit("tsp")).toBe("tsp");
    expect(normalizeUnit("t")).toBe("tsp");
    expect(normalizeUnit("tsp.")).toBe("tsp");
    expect(normalizeUnit("Teaspoon")).toBe("tsp");
    expect(normalizeUnit("  TSP  ")).toBe("tsp");
  });

  it("collapses tablespoon variants to tbsp", () => {
    expect(normalizeUnit("tablespoon")).toBe("tbsp");
    expect(normalizeUnit("tablespoons")).toBe("tbsp");
    expect(normalizeUnit("tbsp")).toBe("tbsp");
    expect(normalizeUnit("T")).toBe("tbsp");
    expect(normalizeUnit("Tbsp.")).toBe("tbsp");
  });

  it("collapses cup variants", () => {
    expect(normalizeUnit("cup")).toBe("cup");
    expect(normalizeUnit("cups")).toBe("cup");
    expect(normalizeUnit("c")).toBe("cup");
  });

  it("collapses weight units", () => {
    expect(normalizeUnit("oz")).toBe("oz");
    expect(normalizeUnit("ounce")).toBe("oz");
    expect(normalizeUnit("ounces")).toBe("oz");
    expect(normalizeUnit("lb")).toBe("lb");
    expect(normalizeUnit("lbs")).toBe("lb");
    expect(normalizeUnit("pound")).toBe("lb");
    expect(normalizeUnit("pounds")).toBe("lb");
    expect(normalizeUnit("g")).toBe("g");
    expect(normalizeUnit("gram")).toBe("g");
    expect(normalizeUnit("grams")).toBe("g");
    expect(normalizeUnit("kg")).toBe("kg");
    expect(normalizeUnit("kilogram")).toBe("kg");
    expect(normalizeUnit("kilograms")).toBe("kg");
  });

  it("collapses volume units", () => {
    expect(normalizeUnit("ml")).toBe("ml");
    expect(normalizeUnit("milliliter")).toBe("ml");
    expect(normalizeUnit("milliliters")).toBe("ml");
    expect(normalizeUnit("l")).toBe("l");
    expect(normalizeUnit("liter")).toBe("l");
    expect(normalizeUnit("liters")).toBe("l");
  });

  it("collapses count-ish units", () => {
    expect(normalizeUnit("each")).toBe("each");
    expect(normalizeUnit("ct")).toBe("each");
    expect(normalizeUnit("count")).toBe("each");
    expect(normalizeUnit("whole")).toBe("each");
    expect(normalizeUnit("can")).toBe("can");
    expect(normalizeUnit("cans")).toBe("can");
    expect(normalizeUnit("package")).toBe("pkg");
    expect(normalizeUnit("packages")).toBe("pkg");
    expect(normalizeUnit("pkg")).toBe("pkg");
    expect(normalizeUnit("pack")).toBe("pkg");
    expect(normalizeUnit("clove")).toBe("clove");
    expect(normalizeUnit("cloves")).toBe("clove");
    expect(normalizeUnit("bunch")).toBe("bunch");
    expect(normalizeUnit("bunches")).toBe("bunch");
    expect(normalizeUnit("slice")).toBe("slice");
    expect(normalizeUnit("slices")).toBe("slice");
    expect(normalizeUnit("sprig")).toBe("sprig");
    expect(normalizeUnit("sprigs")).toBe("sprig");
  });

  it("passes unknown strings through unchanged (trimmed, case-preserved)", () => {
    expect(normalizeUnit("pinch")).toBe("pinch");
    expect(normalizeUnit("Pinch")).toBe("Pinch");
    expect(normalizeUnit("  splash  ")).toBe("splash");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/unit/units-normalize.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `normalizeUnit`**

Create `src/lib/units/normalize.ts`:

```ts
// Canonical form → array of aliases (all matched case-insensitively).
const ALIASES: Record<string, string[]> = {
  tsp: ["teaspoon", "teaspoons", "tsp", "t"],
  tbsp: ["tablespoon", "tablespoons", "tbsp", "T"],
  cup: ["cup", "cups", "c"],
  oz: ["ounce", "ounces", "oz"],
  lb: ["pound", "pounds", "lb", "lbs"],
  g: ["gram", "grams", "g"],
  kg: ["kilogram", "kilograms", "kg"],
  ml: ["milliliter", "milliliters", "ml"],
  l: ["liter", "liters", "l"],
  each: ["each", "ct", "count", "whole"],
  can: ["can", "cans"],
  pkg: ["package", "packages", "pkg", "pack"],
  clove: ["clove", "cloves"],
  bunch: ["bunch", "bunches"],
  slice: ["slice", "slices"],
  sprig: ["sprig", "sprigs"],
};

// The "T" alias for tbsp is intentionally case-sensitive downstream — but we
// still lowercase for map lookup. Since "T" lowercased is "t" which is a tsp
// alias, we special-case "T" (uppercase, exact) before general lowering.
// To keep the map simple we handle this at lookup time.
const LOOKUP: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(ALIASES)) {
    for (const a of aliases) {
      // Store lowercased key, but preserve the ambiguity handled below.
      m.set(a.toLowerCase(), canonical);
    }
  }
  return m;
})();

export function normalizeUnit(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim().replace(/\.$/, "");
  if (trimmed === "") return null;

  // Case-sensitive shortcut: single uppercase T is tablespoon, not teaspoon.
  if (trimmed === "T") return "tbsp";

  const canonical = LOOKUP.get(trimmed.toLowerCase());
  return canonical ?? trimmed;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test tests/unit/units-normalize.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/units/normalize.ts tests/unit/units-normalize.test.ts
git commit -m "feat(units): canonical unit normalization"
```

---

## Task 4: Grocery types

**Files:**
- Create: `src/lib/grocery/types.ts`

Pure type module for reuse across aggregation, API, and client. Mirrors the spec §8 shapes.

- [ ] **Step 1: Create the file**

```ts
export type IngredientCategory =
  | "produce"
  | "meat"
  | "dairy"
  | "pantry"
  | "frozen"
  | "bakery"
  | "other";

export const INGREDIENT_CATEGORIES: IngredientCategory[] = [
  "produce",
  "meat",
  "dairy",
  "pantry",
  "frozen",
  "bakery",
  "other",
];

export type GrocerySource = "derived" | "manual";

// Output of the aggregation step — feeds INSERT rows for grocery_list_items.
export type DerivedItem = {
  ingredientId: string | null;
  displayText: string | null;
  quantity: number | null;
  unit: string | null; // canonical (post-normalization)
  category: IngredientCategory;
  sourceScheduleEntryIds: string[];
};

// Shape returned to the client from every list endpoint.
export type GroceryListItemDto = {
  id: string;
  ingredientId: string | null;
  ingredientName: string | null;
  displayText: string | null;
  quantity: number | null;
  unit: string | null;
  category: IngredientCategory;
  source: GrocerySource;
  checked: boolean;
  checkedAt: string | null;
  sourceScheduleEntryIds: string[];
  sortOrder: number;
  updatedAt: string;
};

export type GroceryListSummaryDto = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isArchived: boolean;
  generatedAt: string;
  lastRegeneratedAt: string | null;
  itemCount: number;
  uncheckedCount: number;
  updatedAt: string;
};

export type GroceryListDetailDto = GroceryListSummaryDto & {
  items: GroceryListItemDto[];
};
```

- [ ] **Step 2: Confirm types compile**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/grocery/types.ts
git commit -m "feat(grocery): shared types"
```

---

## Task 5: `generateDerivedItems` — aggregation algorithm

**Files:**
- Create: `src/lib/grocery/aggregate.ts`
- Create: `tests/unit/grocery-aggregate.test.ts`

Implements the algorithm from spec §5. Two DB queries: `schedule_entries` in range, then `meal_ingredients` joined to `ingredients` for the distinct meal ids.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/grocery-aggregate.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import "@/../tests/setup";
import { db } from "@/lib/db/client";
import {
  families,
  users,
  familyUsers,
  profiles,
  ingredients,
  meals,
  mealIngredients,
  scheduleEntries,
} from "@/lib/db/schema";
import { generateDerivedItems } from "@/lib/grocery/aggregate";
import { resetDb } from "@/../tests/helpers/db";

async function seed() {
  const [family] = await db.insert(families).values({ name: "Test", weekStartsOn: 1 }).returning();
  const [user] = await db.insert(users).values({ clerkUserId: "clerk_g1", email: "g1@t" }).returning();
  await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });
  const [profile] = await db.insert(profiles).values({ familyId: family!.id, displayName: "Sam" }).returning();
  return { family: family!, user: user!, profile: profile! };
}

async function makeIngredient(familyId: string, name: string, category: string, defaultUnit: string | null = null) {
  const [row] = await db.insert(ingredients).values({ familyId, name, category, defaultUnit }).returning();
  return row!;
}

async function makeMeal(familyId: string, name: string) {
  const [row] = await db.insert(meals).values({ familyId, name }).returning();
  return row!;
}

describe("generateDerivedItems", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns [] when the range is empty", async () => {
    const { family } = await seed();
    const items = await generateDerivedItems(family.id, "2026-07-06", "2026-07-12");
    expect(items).toEqual([]);
  });

  it("skips eating-out entries", async () => {
    const { family, user } = await seed();
    await db.insert(scheduleEntries).values({
      familyId: family.id,
      date: "2026-07-06",
      slot: "dinner",
      eatingOut: true,
      eatingOutCost: "12.50",
      createdByUserId: user.id,
      updatedByUserId: user.id,
    });
    const items = await generateDerivedItems(family.id, "2026-07-06", "2026-07-12");
    expect(items).toEqual([]);
  });

  it("aggregates same-ingredient same-unit rows across meals", async () => {
    const { family, user } = await seed();
    const onion = await makeIngredient(family.id, "Onion", "produce");
    const tacos = await makeMeal(family.id, "Tacos");
    const chili = await makeMeal(family.id, "Chili");
    await db.insert(mealIngredients).values([
      { mealId: tacos.id, ingredientId: onion.id, quantity: "2", unit: "cup" },
      { mealId: chili.id, ingredientId: onion.id, quantity: "1", unit: "cup" },
    ]);
    await db.insert(scheduleEntries).values([
      { familyId: family.id, date: "2026-07-06", slot: "dinner", mealId: tacos.id, createdByUserId: user.id, updatedByUserId: user.id },
      { familyId: family.id, date: "2026-07-07", slot: "dinner", mealId: chili.id, createdByUserId: user.id, updatedByUserId: user.id },
    ]);
    const items = await generateDerivedItems(family.id, "2026-07-06", "2026-07-12");
    expect(items).toHaveLength(1);
    expect(items[0]!.ingredientId).toBe(onion.id);
    expect(items[0]!.quantity).toBe(3);
    expect(items[0]!.unit).toBe("cup");
    expect(items[0]!.category).toBe("produce");
    expect(items[0]!.sourceScheduleEntryIds).toHaveLength(2);
  });

  it("normalizes units before bucketing (tablespoon + T + tbsp aggregate)", async () => {
    const { family, user } = await seed();
    const oil = await makeIngredient(family.id, "Olive Oil", "pantry");
    const a = await makeMeal(family.id, "A");
    const b = await makeMeal(family.id, "B");
    const c = await makeMeal(family.id, "C");
    await db.insert(mealIngredients).values([
      { mealId: a.id, ingredientId: oil.id, quantity: "1", unit: "tablespoon" },
      { mealId: b.id, ingredientId: oil.id, quantity: "1", unit: "T" },
      { mealId: c.id, ingredientId: oil.id, quantity: "1", unit: "tbsp." },
    ]);
    await db.insert(scheduleEntries).values([
      { familyId: family.id, date: "2026-07-06", slot: "dinner", mealId: a.id, createdByUserId: user.id, updatedByUserId: user.id },
      { familyId: family.id, date: "2026-07-07", slot: "dinner", mealId: b.id, createdByUserId: user.id, updatedByUserId: user.id },
      { familyId: family.id, date: "2026-07-08", slot: "dinner", mealId: c.id, createdByUserId: user.id, updatedByUserId: user.id },
    ]);
    const items = await generateDerivedItems(family.id, "2026-07-06", "2026-07-12");
    expect(items).toHaveLength(1);
    expect(items[0]!.quantity).toBe(3);
    expect(items[0]!.unit).toBe("tbsp");
  });

  it("does NOT unit-convert (cups and grams of same ingredient stay separate)", async () => {
    const { family, user } = await seed();
    const onion = await makeIngredient(family.id, "Onion", "produce");
    const a = await makeMeal(family.id, "A");
    const b = await makeMeal(family.id, "B");
    await db.insert(mealIngredients).values([
      { mealId: a.id, ingredientId: onion.id, quantity: "1", unit: "cup" },
      { mealId: b.id, ingredientId: onion.id, quantity: "500", unit: "g" },
    ]);
    await db.insert(scheduleEntries).values([
      { familyId: family.id, date: "2026-07-06", slot: "dinner", mealId: a.id, createdByUserId: user.id, updatedByUserId: user.id },
      { familyId: family.id, date: "2026-07-07", slot: "dinner", mealId: b.id, createdByUserId: user.id, updatedByUserId: user.id },
    ]);
    const items = await generateDerivedItems(family.id, "2026-07-06", "2026-07-12");
    expect(items).toHaveLength(2);
    const units = items.map((i) => i.unit).sort();
    expect(units).toEqual(["cup", "g"]);
  });

  it("creates a unitless row when quantity or unit is missing (structured)", async () => {
    const { family, user } = await seed();
    const onion = await makeIngredient(family.id, "Onion", "produce");
    const a = await makeMeal(family.id, "A");
    const b = await makeMeal(family.id, "B");
    await db.insert(mealIngredients).values([
      { mealId: a.id, ingredientId: onion.id, quantity: null, unit: null, displayText: "some onion" },
      { mealId: b.id, ingredientId: onion.id, quantity: null, unit: null, displayText: "another onion" },
    ]);
    await db.insert(scheduleEntries).values([
      { familyId: family.id, date: "2026-07-06", slot: "dinner", mealId: a.id, createdByUserId: user.id, updatedByUserId: user.id },
      { familyId: family.id, date: "2026-07-07", slot: "dinner", mealId: b.id, createdByUserId: user.id, updatedByUserId: user.id },
    ]);
    const items = await generateDerivedItems(family.id, "2026-07-06", "2026-07-12");
    expect(items).toHaveLength(1);
    expect(items[0]!.ingredientId).toBe(onion.id);
    expect(items[0]!.quantity).toBeNull();
    expect(items[0]!.unit).toBeNull();
    expect(items[0]!.sourceScheduleEntryIds).toHaveLength(2);
  });

  it("groups display-text-only rows case-insensitively into a Misc bucket", async () => {
    const { family, user } = await seed();
    const a = await makeMeal(family.id, "A");
    const b = await makeMeal(family.id, "B");
    const c = await makeMeal(family.id, "C");
    await db.insert(mealIngredients).values([
      { mealId: a.id, ingredientId: null, displayText: "a handful of basil" },
      { mealId: b.id, ingredientId: null, displayText: "A Handful of Basil" },
      { mealId: c.id, ingredientId: null, displayText: "salt to taste" },
    ]);
    await db.insert(scheduleEntries).values([
      { familyId: family.id, date: "2026-07-06", slot: "dinner", mealId: a.id, createdByUserId: user.id, updatedByUserId: user.id },
      { familyId: family.id, date: "2026-07-07", slot: "dinner", mealId: b.id, createdByUserId: user.id, updatedByUserId: user.id },
      { familyId: family.id, date: "2026-07-08", slot: "dinner", mealId: c.id, createdByUserId: user.id, updatedByUserId: user.id },
    ]);
    const items = await generateDerivedItems(family.id, "2026-07-06", "2026-07-12");
    expect(items).toHaveLength(2);
    const basil = items.find((i) => i.displayText === "a handful of basil");
    expect(basil).toBeDefined();
    expect(basil!.category).toBe("other");
    expect(basil!.sourceScheduleEntryIds).toHaveLength(2);
  });

  it("counts default rows and per-profile overrides both", async () => {
    const { family, user, profile } = await seed();
    const rice = await makeIngredient(family.id, "Rice", "pantry");
    const beans = await makeIngredient(family.id, "Beans", "pantry");
    const a = await makeMeal(family.id, "Family default"); // uses rice
    const b = await makeMeal(family.id, "Sam's override"); // uses beans
    await db.insert(mealIngredients).values([
      { mealId: a.id, ingredientId: rice.id, quantity: "1", unit: "cup" },
      { mealId: b.id, ingredientId: beans.id, quantity: "1", unit: "can" },
    ]);
    await db.insert(scheduleEntries).values([
      { familyId: family.id, date: "2026-07-06", slot: "dinner", mealId: a.id, createdByUserId: user.id, updatedByUserId: user.id },
      { familyId: family.id, date: "2026-07-06", slot: "dinner", profileId: profile.id, mealId: b.id, createdByUserId: user.id, updatedByUserId: user.id },
    ]);
    const items = await generateDerivedItems(family.id, "2026-07-06", "2026-07-12");
    expect(items).toHaveLength(2);
    const names = items.map((i) => i.ingredientId).sort();
    expect(names).toEqual([rice.id, beans.id].sort());
  });

  it("filters by family and by date range", async () => {
    const { family, user } = await seed();
    const [otherFamily] = await db
      .insert(families)
      .values({ name: "Other", weekStartsOn: 1 })
      .returning();
    const rice = await makeIngredient(family.id, "Rice", "pantry");
    const meal = await makeMeal(family.id, "A");
    await db.insert(mealIngredients).values({
      mealId: meal.id,
      ingredientId: rice.id,
      quantity: "1",
      unit: "cup",
    });
    await db.insert(scheduleEntries).values([
      // Out of range
      { familyId: family.id, date: "2026-07-05", slot: "dinner", mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id },
      // Wrong family
      { familyId: otherFamily!.id, date: "2026-07-06", slot: "dinner", mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id },
    ]);
    const items = await generateDerivedItems(family.id, "2026-07-06", "2026-07-12");
    expect(items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/unit/grocery-aggregate.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `generateDerivedItems`**

Create `src/lib/grocery/aggregate.ts`:

```ts
import { and, between, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  ingredients,
  mealIngredients,
  scheduleEntries,
} from "@/lib/db/schema";
import { normalizeUnit } from "@/lib/units/normalize";
import type { DerivedItem, IngredientCategory } from "./types";

type StructuredKey = string; // `s:${ingredientId}:${canonicalUnit ?? ''}`
type UnitlessKey = string; // `u:${ingredientId}`
type MiscKey = string; // `m:${normalizedDisplay}`

function toNumber(n: string | number | null): number | null {
  if (n === null) return null;
  return typeof n === "number" ? n : Number(n);
}

function normalizeMiscText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function generateDerivedItems(
  familyId: string,
  startDate: string,
  endDate: string,
): Promise<DerivedItem[]> {
  // 1. Load in-range schedule instances with a meal_id and not eating out.
  const instances = await db
    .select({ id: scheduleEntries.id, mealId: scheduleEntries.mealId })
    .from(scheduleEntries)
    .where(
      and(
        eq(scheduleEntries.familyId, familyId),
        between(scheduleEntries.date, startDate, endDate),
        isNotNull(scheduleEntries.mealId),
        eq(scheduleEntries.eatingOut, false),
      ),
    );

  if (instances.length === 0) return [];

  // 2. Load meal_ingredients joined to ingredients for the distinct meal_ids.
  const mealIds = Array.from(new Set(instances.map((i) => i.mealId!).filter(Boolean)));
  const rows = await db
    .select({
      mealId: mealIngredients.mealId,
      ingredientId: mealIngredients.ingredientId,
      quantity: mealIngredients.quantity,
      unit: mealIngredients.unit,
      displayText: mealIngredients.displayText,
      ingredientName: ingredients.name,
      ingredientCategory: ingredients.category,
    })
    .from(mealIngredients)
    .leftJoin(ingredients, eq(mealIngredients.ingredientId, ingredients.id))
    .where(inArray(mealIngredients.mealId, mealIds));

  // 3. Bucket per §5 of the design.
  const structured = new Map<StructuredKey, DerivedItem>();
  const unitless = new Map<UnitlessKey, DerivedItem>();
  const misc = new Map<MiscKey, DerivedItem>();

  const byMeal = new Map<string, typeof rows>();
  for (const row of rows) {
    const existing = byMeal.get(row.mealId) ?? [];
    existing.push(row);
    byMeal.set(row.mealId, existing);
  }

  for (const inst of instances) {
    if (!inst.mealId) continue;
    const mealRows = byMeal.get(inst.mealId) ?? [];
    for (const row of mealRows) {
      const qty = toNumber(row.quantity);
      const canonicalUnit = normalizeUnit(row.unit);

      if (row.ingredientId !== null && qty !== null && canonicalUnit !== null) {
        const key: StructuredKey = `s:${row.ingredientId}:${canonicalUnit}`;
        const prev = structured.get(key);
        if (prev) {
          prev.quantity = (prev.quantity ?? 0) + qty;
          prev.sourceScheduleEntryIds.push(inst.id);
        } else {
          structured.set(key, {
            ingredientId: row.ingredientId,
            displayText: null,
            quantity: qty,
            unit: canonicalUnit,
            category: (row.ingredientCategory ?? "other") as IngredientCategory,
            sourceScheduleEntryIds: [inst.id],
          });
        }
        continue;
      }

      if (row.ingredientId !== null) {
        // Unitless or partial: one bucket per ingredient, quantity/unit unset.
        const key: UnitlessKey = `u:${row.ingredientId}`;
        const prev = unitless.get(key);
        if (prev) {
          prev.sourceScheduleEntryIds.push(inst.id);
        } else {
          unitless.set(key, {
            ingredientId: row.ingredientId,
            displayText: null,
            quantity: null,
            unit: null,
            category: (row.ingredientCategory ?? "other") as IngredientCategory,
            sourceScheduleEntryIds: [inst.id],
          });
        }
        continue;
      }

      // Misc: display-text-only.
      if (row.displayText !== null) {
        const norm = normalizeMiscText(row.displayText);
        const key: MiscKey = `m:${norm}`;
        const prev = misc.get(key);
        if (prev) {
          prev.sourceScheduleEntryIds.push(inst.id);
        } else {
          misc.set(key, {
            ingredientId: null,
            displayText: row.displayText,
            quantity: null,
            unit: null,
            category: "other",
            sourceScheduleEntryIds: [inst.id],
          });
        }
      }
    }
  }

  return [...structured.values(), ...unitless.values(), ...misc.values()];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test tests/unit/grocery-aggregate.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/grocery/aggregate.ts tests/unit/grocery-aggregate.test.ts
git commit -m "feat(grocery): generateDerivedItems aggregation"
```

---

## Task 6: `regenerateList` — regenerate-merge helper

**Files:**
- Create: `src/lib/grocery/regenerate.ts`
- Create: `tests/unit/grocery-regenerate.test.ts`

Wraps `generateDerivedItems` in a transaction that (a) records existing derived checked-state by aggregation key, (b) deletes all `source='derived'` rows, (c) inserts fresh derived rows with checked-state restored where the key matches, (d) touches `last_regenerated_at`. Manual rows are untouched.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/grocery-regenerate.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import "@/../tests/setup";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  families, users, familyUsers, ingredients, meals, mealIngredients,
  scheduleEntries, groceryLists, groceryListItems,
} from "@/lib/db/schema";
import { regenerateList } from "@/lib/grocery/regenerate";
import { resetDb } from "@/../tests/helpers/db";

async function seed() {
  const [family] = await db.insert(families).values({ name: "F", weekStartsOn: 1 }).returning();
  const [user] = await db.insert(users).values({ clerkUserId: "clerk_r1", email: "r1@t" }).returning();
  await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });
  return { family: family!, user: user! };
}

describe("regenerateList", () => {
  beforeEach(async () => await resetDb());

  it("preserves manual items across regenerate", async () => {
    const { family, user } = await seed();
    const [list] = await db.insert(groceryLists).values({
      familyId: family.id, name: "L1", startDate: "2026-07-06", endDate: "2026-07-12",
      createdByUserId: user.id, updatedByUserId: user.id,
    }).returning();
    await db.insert(groceryListItems).values({
      listId: list!.id, displayText: "paper towels", category: "other", source: "manual",
    });

    await regenerateList(list!.id, user.id);

    const items = await db.select().from(groceryListItems).where(eq(groceryListItems.listId, list!.id));
    expect(items).toHaveLength(1);
    expect(items[0]!.source).toBe("manual");
    expect(items[0]!.displayText).toBe("paper towels");
  });

  it("preserves checked state on derived rows whose key survives", async () => {
    const { family, user } = await seed();
    const rice = await db.insert(ingredients).values({ familyId: family.id, name: "Rice", category: "pantry" }).returning();
    const meal = await db.insert(meals).values({ familyId: family.id, name: "A" }).returning();
    await db.insert(mealIngredients).values({
      mealId: meal[0]!.id, ingredientId: rice[0]!.id, quantity: "1", unit: "cup",
    });
    await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-07-06", slot: "dinner", mealId: meal[0]!.id,
      createdByUserId: user.id, updatedByUserId: user.id,
    });

    const [list] = await db.insert(groceryLists).values({
      familyId: family.id, name: "L", startDate: "2026-07-06", endDate: "2026-07-12",
      createdByUserId: user.id, updatedByUserId: user.id,
    }).returning();

    // First regen — populates derived rows
    await regenerateList(list!.id, user.id);

    // Check off the rice row
    await db.update(groceryListItems)
      .set({ checked: true, checkedAt: new Date(), checkedByUserId: user.id })
      .where(and(eq(groceryListItems.listId, list!.id), eq(groceryListItems.ingredientId, rice[0]!.id)));

    // Add another meal that uses rice too — so the aggregation key survives
    const meal2 = await db.insert(meals).values({ familyId: family.id, name: "B" }).returning();
    await db.insert(mealIngredients).values({
      mealId: meal2[0]!.id, ingredientId: rice[0]!.id, quantity: "2", unit: "cup",
    });
    await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-07-07", slot: "dinner", mealId: meal2[0]!.id,
      createdByUserId: user.id, updatedByUserId: user.id,
    });

    await regenerateList(list!.id, user.id);

    const [ricRow] = await db.select().from(groceryListItems)
      .where(and(eq(groceryListItems.listId, list!.id), eq(groceryListItems.ingredientId, rice[0]!.id)));
    expect(ricRow!.checked).toBe(true);
    expect(ricRow!.checkedByUserId).toBe(user.id);
    expect(Number(ricRow!.quantity)).toBe(3);
  });

  it("drops derived rows whose key no longer appears", async () => {
    const { family, user } = await seed();
    const onion = await db.insert(ingredients).values({ familyId: family.id, name: "Onion", category: "produce" }).returning();
    const meal = await db.insert(meals).values({ familyId: family.id, name: "A" }).returning();
    await db.insert(mealIngredients).values({
      mealId: meal[0]!.id, ingredientId: onion[0]!.id, quantity: "1", unit: "cup",
    });
    const sched = await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-07-06", slot: "dinner", mealId: meal[0]!.id,
      createdByUserId: user.id, updatedByUserId: user.id,
    }).returning();

    const [list] = await db.insert(groceryLists).values({
      familyId: family.id, name: "L", startDate: "2026-07-06", endDate: "2026-07-12",
      createdByUserId: user.id, updatedByUserId: user.id,
    }).returning();
    await regenerateList(list!.id, user.id);

    // Remove the schedule entry — regenerate should drop the onion row
    await db.delete(scheduleEntries).where(eq(scheduleEntries.id, sched[0]!.id));

    await regenerateList(list!.id, user.id);

    const items = await db.select().from(groceryListItems).where(eq(groceryListItems.listId, list!.id));
    expect(items).toEqual([]);
  });

  it("touches last_regenerated_at and updated_by_user_id", async () => {
    const { family, user } = await seed();
    const [list] = await db.insert(groceryLists).values({
      familyId: family.id, name: "L", startDate: "2026-07-06", endDate: "2026-07-12",
      createdByUserId: user.id, updatedByUserId: user.id,
    }).returning();

    await regenerateList(list!.id, user.id);

    const [after] = await db.select().from(groceryLists).where(eq(groceryLists.id, list!.id));
    expect(after!.lastRegeneratedAt).toBeTruthy();
    expect(after!.updatedByUserId).toBe(user.id);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/unit/grocery-regenerate.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `regenerateList`**

Create `src/lib/grocery/regenerate.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { groceryLists, groceryListItems, type NewGroceryListItem } from "@/lib/db/schema";
import { NotFoundError } from "@/lib/auth/errors";
import { generateDerivedItems } from "./aggregate";

type PreservedCheck = {
  checkedAt: Date | null;
  checkedByUserId: string | null;
};

function matchKey(row: {
  ingredientId: string | null;
  displayText: string | null;
  unit: string | null;
}): string {
  if (row.ingredientId) {
    return `s:${row.ingredientId}:${row.unit ?? ""}`;
  }
  const norm = (row.displayText ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return `m:${norm}`;
}

export async function regenerateList(listId: string, actorUserId: string): Promise<void> {
  const [list] = await db.select().from(groceryLists).where(eq(groceryLists.id, listId));
  if (!list) throw new NotFoundError("Grocery list not found");

  const current = await db
    .select()
    .from(groceryListItems)
    .where(and(eq(groceryListItems.listId, listId), eq(groceryListItems.source, "derived")));

  const preservedByKey = new Map<string, PreservedCheck>();
  for (const row of current) {
    if (!row.checked) continue;
    preservedByKey.set(matchKey(row), {
      checkedAt: row.checkedAt,
      checkedByUserId: row.checkedByUserId,
    });
  }

  const newItems = await generateDerivedItems(list.familyId, list.startDate, list.endDate);

  await db.transaction(async (tx) => {
    await tx
      .delete(groceryListItems)
      .where(and(eq(groceryListItems.listId, listId), eq(groceryListItems.source, "derived")));

    if (newItems.length > 0) {
      const inserts: NewGroceryListItem[] = newItems.map((it) => {
        const preserved = preservedByKey.get(
          matchKey({ ingredientId: it.ingredientId, displayText: it.displayText, unit: it.unit }),
        );
        return {
          listId,
          ingredientId: it.ingredientId,
          displayText: it.displayText,
          quantity: it.quantity !== null ? String(it.quantity) : null,
          unit: it.unit,
          category: it.category,
          source: "derived",
          checked: preserved !== undefined,
          checkedAt: preserved?.checkedAt ?? null,
          checkedByUserId: preserved?.checkedByUserId ?? null,
          sourceScheduleEntryIds: it.sourceScheduleEntryIds,
        };
      });
      await tx.insert(groceryListItems).values(inserts);
    }

    await tx
      .update(groceryLists)
      .set({ lastRegeneratedAt: new Date(), updatedByUserId: actorUserId, updatedAt: new Date() })
      .where(eq(groceryLists.id, listId));
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test tests/unit/grocery-regenerate.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/grocery/regenerate.ts tests/unit/grocery-regenerate.test.ts
git commit -m "feat(grocery): regenerateList preserves manual + matching check-off"
```

---

## Task 7: `carryOverUnchecked` — carry-over helper

**Files:**
- Create: `src/lib/grocery/carry-over.ts`
- Create: `tests/unit/grocery-carry-over.test.ts`

Reads all `checked = false` items from source list and inserts them into target as **manual** rows, so they survive the target's next regenerate.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/grocery-carry-over.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import "@/../tests/setup";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  families, users, familyUsers, ingredients, groceryLists, groceryListItems,
} from "@/lib/db/schema";
import { carryOverUnchecked } from "@/lib/grocery/carry-over";
import { resetDb } from "@/../tests/helpers/db";

async function seed() {
  const [family] = await db.insert(families).values({ name: "F", weekStartsOn: 1 }).returning();
  const [user] = await db.insert(users).values({ clerkUserId: "clerk_c1", email: "c1@t" }).returning();
  await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });
  return { family: family!, user: user! };
}

describe("carryOverUnchecked", () => {
  beforeEach(async () => await resetDb());

  it("copies only unchecked items and marks them source=manual on target", async () => {
    const { family, user } = await seed();
    const rice = await db.insert(ingredients).values({ familyId: family.id, name: "Rice", category: "pantry" }).returning();
    const [src] = await db.insert(groceryLists).values({
      familyId: family.id, name: "src", startDate: "2026-07-06", endDate: "2026-07-12",
      createdByUserId: user.id, updatedByUserId: user.id,
    }).returning();
    const [dst] = await db.insert(groceryLists).values({
      familyId: family.id, name: "dst", startDate: "2026-07-13", endDate: "2026-07-19",
      createdByUserId: user.id, updatedByUserId: user.id,
    }).returning();
    await db.insert(groceryListItems).values([
      { listId: src!.id, ingredientId: rice[0]!.id, quantity: "1", unit: "cup", category: "pantry", source: "derived", checked: false },
      { listId: src!.id, ingredientId: null, displayText: "salt", category: "other", source: "derived", checked: true, checkedAt: new Date(), checkedByUserId: user.id },
      { listId: src!.id, ingredientId: null, displayText: "paper towels", category: "other", source: "manual", checked: false },
    ]);

    const result = await carryOverUnchecked(src!.id, dst!.id, user.id);
    expect(result.added).toBe(2);

    const items = await db.select().from(groceryListItems).where(eq(groceryListItems.listId, dst!.id));
    expect(items).toHaveLength(2);
    for (const it of items) {
      expect(it.source).toBe("manual");
      expect(it.checked).toBe(false);
      expect(it.checkedAt).toBeNull();
    }
  });

  it("does not touch source rows", async () => {
    const { family, user } = await seed();
    const [src] = await db.insert(groceryLists).values({
      familyId: family.id, name: "src", startDate: "2026-07-06", endDate: "2026-07-12",
      createdByUserId: user.id, updatedByUserId: user.id,
    }).returning();
    const [dst] = await db.insert(groceryLists).values({
      familyId: family.id, name: "dst", startDate: "2026-07-13", endDate: "2026-07-19",
      createdByUserId: user.id, updatedByUserId: user.id,
    }).returning();
    await db.insert(groceryListItems).values({
      listId: src!.id, displayText: "salt", category: "other", source: "manual", checked: false,
    });
    await carryOverUnchecked(src!.id, dst!.id, user.id);
    const srcItems = await db.select().from(groceryListItems).where(eq(groceryListItems.listId, src!.id));
    expect(srcItems).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/unit/grocery-carry-over.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `carryOverUnchecked`**

Create `src/lib/grocery/carry-over.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { groceryLists, groceryListItems, type NewGroceryListItem } from "@/lib/db/schema";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/auth/errors";

export async function carryOverUnchecked(
  fromListId: string,
  toListId: string,
  actorUserId: string,
): Promise<{ added: number }> {
  if (fromListId === toListId) {
    throw new ValidationError("Source and target lists must differ");
  }
  const [from] = await db.select().from(groceryLists).where(eq(groceryLists.id, fromListId));
  const [to] = await db.select().from(groceryLists).where(eq(groceryLists.id, toListId));
  if (!from) throw new NotFoundError("Source list not found");
  if (!to) throw new NotFoundError("Target list not found");
  if (from.familyId !== to.familyId) throw new ForbiddenError("Cross-family carry-over");

  const unchecked = await db
    .select()
    .from(groceryListItems)
    .where(and(eq(groceryListItems.listId, fromListId), eq(groceryListItems.checked, false)));

  if (unchecked.length === 0) return { added: 0 };

  const inserts: NewGroceryListItem[] = unchecked.map((row) => ({
    listId: toListId,
    ingredientId: row.ingredientId,
    displayText: row.displayText,
    quantity: row.quantity,
    unit: row.unit,
    category: row.category,
    source: "manual",
    checked: false,
    sourceScheduleEntryIds: [],
  }));

  await db.transaction(async (tx) => {
    await tx.insert(groceryListItems).values(inserts);
    await tx
      .update(groceryLists)
      .set({ updatedAt: new Date(), updatedByUserId: actorUserId })
      .where(eq(groceryLists.id, toListId));
  });

  return { added: inserts.length };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test tests/unit/grocery-carry-over.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/grocery/carry-over.ts tests/unit/grocery-carry-over.test.ts
git commit -m "feat(grocery): carryOverUnchecked to manual on target"
```

---

## Task 8: Zod validation schemas

**Files:**
- Create: `src/lib/validation/grocery.ts`
- Create: `tests/unit/validation-grocery.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/validation-grocery.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  CreateGroceryListSchema,
  UpdateGroceryListSchema,
  CreateGroceryItemSchema,
  UpdateGroceryItemSchema,
  CarryOverSchema,
} from "@/lib/validation/grocery";

describe("CreateGroceryListSchema", () => {
  it("accepts a valid body", () => {
    const parsed = CreateGroceryListSchema.parse({
      name: "Groceries", startDate: "2026-07-06", endDate: "2026-07-12",
    });
    expect(parsed.name).toBe("Groceries");
  });

  it("rejects endDate before startDate", () => {
    expect(() =>
      CreateGroceryListSchema.parse({ name: "x", startDate: "2026-07-12", endDate: "2026-07-06" }),
    ).toThrow();
  });

  it("rejects date-range span > 90 days", () => {
    expect(() =>
      CreateGroceryListSchema.parse({ name: "x", startDate: "2026-01-01", endDate: "2026-06-01" }),
    ).toThrow();
  });

  it("allows omitting name (server assigns default)", () => {
    const parsed = CreateGroceryListSchema.parse({ startDate: "2026-07-06", endDate: "2026-07-12" });
    expect(parsed.name).toBeUndefined();
  });
});

describe("CreateGroceryItemSchema", () => {
  it("requires ingredientId or displayText", () => {
    expect(() => CreateGroceryItemSchema.parse({ category: "produce" })).toThrow();
  });

  it("accepts displayText only", () => {
    const parsed = CreateGroceryItemSchema.parse({ displayText: "salt", category: "other" });
    expect(parsed.displayText).toBe("salt");
  });

  it("accepts ingredientId only", () => {
    const parsed = CreateGroceryItemSchema.parse({
      ingredientId: "00000000-0000-0000-0000-000000000001", category: "produce",
    });
    expect(parsed.ingredientId).toBeDefined();
  });

  it("rejects invalid category", () => {
    expect(() =>
      CreateGroceryItemSchema.parse({ displayText: "x", category: "beverages" as never }),
    ).toThrow();
  });
});

describe("UpdateGroceryItemSchema", () => {
  it("accepts partial updates", () => {
    expect(() => UpdateGroceryItemSchema.parse({ checked: true })).not.toThrow();
    expect(() => UpdateGroceryItemSchema.parse({ quantity: 3 })).not.toThrow();
  });
});

describe("CarryOverSchema", () => {
  it("rejects same source and target", () => {
    expect(() =>
      CarryOverSchema.parse({ toListId: "same" }, { path: [] }),
    ).toThrow();
  });
});
```

*(The `CarryOverSchema` same-source check is enforced in the helper, not the schema — adjust the test to just parse a well-formed body and let the helper own the identity check.)*

- [ ] **Step 2: Implement the schemas**

Create `src/lib/validation/grocery.ts`:

```ts
import { z } from "zod";
import { INGREDIENT_CATEGORIES } from "@/lib/grocery/types";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const uuid = z.string().uuid();
const category = z.enum(INGREDIENT_CATEGORIES as [string, ...string[]]);

function daysBetween(a: string, b: string): number {
  const A = Date.parse(a + "T00:00:00Z");
  const B = Date.parse(b + "T00:00:00Z");
  return Math.floor((B - A) / (24 * 60 * 60 * 1000));
}

const dateRangeRefine = <T extends { startDate: string; endDate: string }>(
  data: T,
  ctx: z.RefinementCtx,
) => {
  if (data.endDate < data.startDate) {
    ctx.addIssue({ code: "custom", message: "endDate must be on or after startDate" });
  }
  if (daysBetween(data.startDate, data.endDate) > 90) {
    ctx.addIssue({ code: "custom", message: "Date range too long (max 90 days)" });
  }
};

export const CreateGroceryListSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    startDate: isoDate,
    endDate: isoDate,
  })
  .superRefine(dateRangeRefine);

export const UpdateGroceryListSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    isArchived: z.boolean().optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.startDate && data.endDate) dateRangeRefine({ startDate: data.startDate, endDate: data.endDate }, ctx);
  });

export const CreateGroceryItemSchema = z
  .object({
    ingredientId: uuid.optional(),
    displayText: z.string().trim().min(1).max(120).optional(),
    quantity: z.number().min(0).max(9999.999).optional(),
    unit: z.string().trim().max(30).optional(),
    category,
  })
  .superRefine((data, ctx) => {
    if (!data.ingredientId && !data.displayText) {
      ctx.addIssue({ code: "custom", message: "ingredientId or displayText required" });
    }
  });

export const UpdateGroceryItemSchema = z.object({
  checked: z.boolean().optional(),
  displayText: z.string().trim().min(1).max(120).optional(),
  quantity: z.number().min(0).max(9999.999).nullable().optional(),
  unit: z.string().trim().max(30).nullable().optional(),
  category: category.optional(),
});

export const CarryOverSchema = z.object({
  toListId: uuid,
});

export type CreateGroceryListInput = z.infer<typeof CreateGroceryListSchema>;
export type UpdateGroceryListInput = z.infer<typeof UpdateGroceryListSchema>;
export type CreateGroceryItemInput = z.infer<typeof CreateGroceryItemSchema>;
export type UpdateGroceryItemInput = z.infer<typeof UpdateGroceryItemSchema>;
export type CarryOverInput = z.infer<typeof CarryOverSchema>;
```

- [ ] **Step 3: Run the tests**

```bash
pnpm test tests/unit/validation-grocery.test.ts
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/validation/grocery.ts tests/unit/validation-grocery.test.ts
git commit -m "feat(grocery): Zod validation schemas"
```

---

## Task 9: Serialize helper

**Files:**
- Create: `src/lib/grocery/serialize.ts`

Centralizes row → DTO conversion so all endpoints emit identical shapes.

- [ ] **Step 1: Create the file**

```ts
import type { GroceryList, GroceryListItem } from "@/lib/db/schema";
import type {
  GroceryListDetailDto,
  GroceryListItemDto,
  GroceryListSummaryDto,
  IngredientCategory,
  GrocerySource,
} from "./types";

type ItemJoinRow = GroceryListItem & { ingredientName: string | null };

export function serializeItem(row: ItemJoinRow): GroceryListItemDto {
  return {
    id: row.id,
    ingredientId: row.ingredientId,
    ingredientName: row.ingredientName,
    displayText: row.displayText,
    quantity: row.quantity !== null ? Number(row.quantity) : null,
    unit: row.unit,
    category: row.category as IngredientCategory,
    source: row.source as GrocerySource,
    checked: row.checked,
    checkedAt: row.checkedAt ? row.checkedAt.toISOString() : null,
    sourceScheduleEntryIds: row.sourceScheduleEntryIds,
    sortOrder: row.sortOrder,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeSummary(
  list: GroceryList,
  itemCount: number,
  uncheckedCount: number,
): GroceryListSummaryDto {
  return {
    id: list.id,
    name: list.name,
    startDate: list.startDate,
    endDate: list.endDate,
    isArchived: list.isArchived,
    generatedAt: list.generatedAt.toISOString(),
    lastRegeneratedAt: list.lastRegeneratedAt ? list.lastRegeneratedAt.toISOString() : null,
    itemCount,
    uncheckedCount,
    updatedAt: list.updatedAt.toISOString(),
  };
}

export function serializeDetail(
  list: GroceryList,
  items: GroceryListItemDto[],
): GroceryListDetailDto {
  const uncheckedCount = items.filter((i) => !i.checked).length;
  return {
    ...serializeSummary(list, items.length, uncheckedCount),
    items,
  };
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm typecheck
git add src/lib/grocery/serialize.ts
git commit -m "feat(grocery): serialize helpers"
```

---

## Task 10: `GET` + `POST /api/grocery/lists`

**Files:**
- Create: `src/app/api/grocery/lists/route.ts`
- Create: `tests/integration/api-grocery-lists.test.ts`

- [ ] **Step 1: Implement the route**

Create `src/app/api/grocery/lists/route.ts`:

```ts
import { and, count, desc, eq } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { withFamily } from "@/lib/auth/with-family";
import { ValidationError } from "@/lib/auth/errors";
import { db } from "@/lib/db/client";
import { groceryLists, groceryListItems } from "@/lib/db/schema";
import { CreateGroceryListSchema } from "@/lib/validation/grocery";
import { generateDerivedItems } from "@/lib/grocery/aggregate";
import { serializeDetail, serializeItem, serializeSummary } from "@/lib/grocery/serialize";
import type { GroceryListItemDto } from "@/lib/grocery/types";

function defaultName(startDate: string, endDate: string): string {
  return `Groceries — ${startDate} → ${endDate}`;
}

export const GET = apiHandler(async (req) => {
  const { familyId } = await withFamily();
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("includeArchived") === "true";

  const rows = await db
    .select({
      list: groceryLists,
      itemCount: count(groceryListItems.id),
    })
    .from(groceryLists)
    .leftJoin(groceryListItems, eq(groceryListItems.listId, groceryLists.id))
    .where(
      includeArchived
        ? eq(groceryLists.familyId, familyId)
        : and(eq(groceryLists.familyId, familyId), eq(groceryLists.isArchived, false)),
    )
    .groupBy(groceryLists.id)
    .orderBy(desc(groceryLists.generatedAt));

  // Second query for unchecked counts — avoids nested aggregates.
  const uncheckedRows = await db
    .select({ listId: groceryListItems.listId, unchecked: count(groceryListItems.id) })
    .from(groceryListItems)
    .where(eq(groceryListItems.checked, false))
    .groupBy(groceryListItems.listId);
  const uncheckedByList = new Map(uncheckedRows.map((r) => [r.listId, Number(r.unchecked)]));

  return {
    items: rows.map((r) =>
      serializeSummary(r.list, Number(r.itemCount), uncheckedByList.get(r.list.id) ?? 0),
    ),
  };
});

export const POST = apiHandler(async (req) => {
  const { familyId, userId } = await withFamily();
  const body = await req.json();
  const input = CreateGroceryListSchema.parse(body);
  const name = input.name ?? defaultName(input.startDate, input.endDate);

  const detail = await db.transaction(async (tx) => {
    const [list] = await tx
      .insert(groceryLists)
      .values({
        familyId,
        name,
        startDate: input.startDate,
        endDate: input.endDate,
        createdByUserId: userId,
        updatedByUserId: userId,
      })
      .returning();
    if (!list) throw new ValidationError("Failed to create list");

    const derived = await generateDerivedItems(familyId, input.startDate, input.endDate);
    if (derived.length > 0) {
      await tx.insert(groceryListItems).values(
        derived.map((it) => ({
          listId: list.id,
          ingredientId: it.ingredientId,
          displayText: it.displayText,
          quantity: it.quantity !== null ? String(it.quantity) : null,
          unit: it.unit,
          category: it.category,
          source: "derived" as const,
          sourceScheduleEntryIds: it.sourceScheduleEntryIds,
        })),
      );
    }

    return list;
  });

  const items = await loadItemsWithJoin(detail.id);
  return serializeDetail(detail, items);
});

async function loadItemsWithJoin(listId: string): Promise<GroceryListItemDto[]> {
  const { ingredients } = await import("@/lib/db/schema");
  const rows = await db
    .select({
      id: groceryListItems.id,
      listId: groceryListItems.listId,
      ingredientId: groceryListItems.ingredientId,
      displayText: groceryListItems.displayText,
      quantity: groceryListItems.quantity,
      unit: groceryListItems.unit,
      category: groceryListItems.category,
      source: groceryListItems.source,
      checked: groceryListItems.checked,
      checkedAt: groceryListItems.checkedAt,
      checkedByUserId: groceryListItems.checkedByUserId,
      sourceScheduleEntryIds: groceryListItems.sourceScheduleEntryIds,
      sortOrder: groceryListItems.sortOrder,
      createdAt: groceryListItems.createdAt,
      updatedAt: groceryListItems.updatedAt,
      ingredientName: ingredients.name,
    })
    .from(groceryListItems)
    .leftJoin(ingredients, eq(groceryListItems.ingredientId, ingredients.id))
    .where(eq(groceryListItems.listId, listId));
  return rows.map(serializeItem);
}
```

- [ ] **Step 2: Write integration tests**

Create `tests/integration/api-grocery-lists.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import "@/../tests/setup";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { families, users, familyUsers, ingredients, meals, mealIngredients, scheduleEntries, groceryLists } from "@/lib/db/schema";
import { resetDb } from "@/../tests/helpers/db";
import { mockClerkUser } from "@/../tests/helpers/auth";
import { POST as postList, GET as getLists } from "@/app/api/grocery/lists/route";

async function seedFamily(clerkUserId = "clerk_gl1") {
  const [family] = await db.insert(families).values({ name: "F", weekStartsOn: 1 }).returning();
  const [user] = await db.insert(users).values({ clerkUserId, email: "gl1@t" }).returning();
  await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });
  return { family: family!, user: user!, clerkUserId };
}

describe("POST /api/grocery/lists", () => {
  beforeEach(async () => await resetDb());

  it("creates a list and populates derived items in one transaction", async () => {
    const { family, user, clerkUserId } = await seedFamily();
    const rice = await db.insert(ingredients).values({ familyId: family.id, name: "Rice", category: "pantry" }).returning();
    const meal = await db.insert(meals).values({ familyId: family.id, name: "A" }).returning();
    await db.insert(mealIngredients).values({ mealId: meal[0]!.id, ingredientId: rice[0]!.id, quantity: "1", unit: "cup" });
    await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-07-06", slot: "dinner", mealId: meal[0]!.id,
      createdByUserId: user.id, updatedByUserId: user.id,
    });

    mockClerkUser(clerkUserId);
    const req = new Request("http://x/api/grocery/lists", {
      method: "POST",
      body: JSON.stringify({ startDate: "2026-07-06", endDate: "2026-07-12" }),
    });
    const res = await postList(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; items: { ingredientName: string | null }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.ingredientName).toBe("Rice");
  });

  it("returns 422 on invalid date range", async () => {
    const { clerkUserId } = await seedFamily();
    mockClerkUser(clerkUserId);
    const req = new Request("http://x/api/grocery/lists", {
      method: "POST",
      body: JSON.stringify({ startDate: "2026-07-12", endDate: "2026-07-06" }),
    });
    const res = await postList(req, { params: Promise.resolve({}) });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe("GET /api/grocery/lists", () => {
  beforeEach(async () => await resetDb());

  it("lists only the caller's family", async () => {
    const { family: a, clerkUserId: ck } = await seedFamily("clerk_gl2");
    const { family: b } = await seedFamily("clerk_gl3");
    await db.insert(groceryLists).values([
      { familyId: a.id, name: "mine", startDate: "2026-07-06", endDate: "2026-07-12" },
      { familyId: b.id, name: "theirs", startDate: "2026-07-06", endDate: "2026-07-12" },
    ]);
    mockClerkUser(ck);
    const req = new Request("http://x/api/grocery/lists");
    const res = await getLists(req, { params: Promise.resolve({}) });
    const body = (await res.json()) as { items: { name: string }[] };
    expect(body.items.map((i) => i.name)).toEqual(["mine"]);
  });

  it("excludes archived by default and includes with query param", async () => {
    const { family, clerkUserId } = await seedFamily("clerk_gl4");
    await db.insert(groceryLists).values([
      { familyId: family.id, name: "active", startDate: "2026-07-06", endDate: "2026-07-12" },
      { familyId: family.id, name: "old", startDate: "2026-06-01", endDate: "2026-06-07", isArchived: true },
    ]);
    mockClerkUser(clerkUserId);

    let res = await getLists(new Request("http://x/api/grocery/lists"), { params: Promise.resolve({}) });
    let body = (await res.json()) as { items: { name: string }[] };
    expect(body.items.map((i) => i.name)).toEqual(["active"]);

    res = await getLists(new Request("http://x/api/grocery/lists?includeArchived=true"), { params: Promise.resolve({}) });
    body = (await res.json()) as { items: { name: string }[] };
    expect(body.items.length).toBe(2);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm test tests/integration/api-grocery-lists.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/grocery/lists/route.ts tests/integration/api-grocery-lists.test.ts
git commit -m "feat(api): GET + POST /api/grocery/lists"
```

---

## Task 11: `GET` + `PATCH` + `DELETE /api/grocery/lists/[id]`

**Files:**
- Create: `src/app/api/grocery/lists/[id]/route.ts`

`PATCH` triggers regenerate atomically when `startDate` or `endDate` changes.

- [ ] **Step 1: Implement**

Create `src/app/api/grocery/lists/[id]/route.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { withFamily } from "@/lib/auth/with-family";
import { NotFoundError } from "@/lib/auth/errors";
import { db } from "@/lib/db/client";
import { groceryLists, groceryListItems, ingredients } from "@/lib/db/schema";
import { UpdateGroceryListSchema } from "@/lib/validation/grocery";
import { regenerateList } from "@/lib/grocery/regenerate";
import { serializeDetail, serializeItem } from "@/lib/grocery/serialize";

type Ctx = { params: Promise<{ id: string }> };

async function loadOrThrow(listId: string, familyId: string) {
  const [list] = await db
    .select()
    .from(groceryLists)
    .where(and(eq(groceryLists.id, listId), eq(groceryLists.familyId, familyId)));
  if (!list) throw new NotFoundError("Grocery list not found");
  return list;
}

async function loadItems(listId: string) {
  const rows = await db
    .select({
      id: groceryListItems.id,
      listId: groceryListItems.listId,
      ingredientId: groceryListItems.ingredientId,
      displayText: groceryListItems.displayText,
      quantity: groceryListItems.quantity,
      unit: groceryListItems.unit,
      category: groceryListItems.category,
      source: groceryListItems.source,
      checked: groceryListItems.checked,
      checkedAt: groceryListItems.checkedAt,
      checkedByUserId: groceryListItems.checkedByUserId,
      sourceScheduleEntryIds: groceryListItems.sourceScheduleEntryIds,
      sortOrder: groceryListItems.sortOrder,
      createdAt: groceryListItems.createdAt,
      updatedAt: groceryListItems.updatedAt,
      ingredientName: ingredients.name,
    })
    .from(groceryListItems)
    .leftJoin(ingredients, eq(groceryListItems.ingredientId, ingredients.id))
    .where(eq(groceryListItems.listId, listId));
  return rows.map(serializeItem);
}

export const GET = apiHandler<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const { familyId } = await withFamily();
  const list = await loadOrThrow(id, familyId);
  const items = await loadItems(id);
  return serializeDetail(list, items);
});

export const PATCH = apiHandler<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const { familyId, userId } = await withFamily();
  const list = await loadOrThrow(id, familyId);
  const body = await req.json();
  const input = UpdateGroceryListSchema.parse(body);

  const dateChanged =
    (input.startDate && input.startDate !== list.startDate) ||
    (input.endDate && input.endDate !== list.endDate);

  await db
    .update(groceryLists)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.isArchived !== undefined ? { isArchived: input.isArchived } : {}),
      ...(input.startDate ? { startDate: input.startDate } : {}),
      ...(input.endDate ? { endDate: input.endDate } : {}),
      updatedAt: new Date(),
      updatedByUserId: userId,
    })
    .where(eq(groceryLists.id, id));

  if (dateChanged) {
    await regenerateList(id, userId);
  }

  const fresh = await loadOrThrow(id, familyId);
  const items = await loadItems(id);
  return serializeDetail(fresh, items);
});

export const DELETE = apiHandler<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const { familyId } = await withFamily();
  await loadOrThrow(id, familyId);
  await db.delete(groceryLists).where(eq(groceryLists.id, id));
  return null;
});
```

- [ ] **Step 2: Add a smoke integration test to `tests/integration/api-grocery-lists.test.ts`**

Append after the existing describe blocks:

```ts
import { PATCH as patchList, DELETE as deleteList } from "@/app/api/grocery/lists/[id]/route";

describe("PATCH /api/grocery/lists/[id]", () => {
  beforeEach(async () => await resetDb());

  it("regenerates when the date range changes", async () => {
    const { family, user, clerkUserId } = await seedFamily("clerk_gl_patch");
    const rice = await db.insert(ingredients).values({ familyId: family.id, name: "Rice", category: "pantry" }).returning();
    const meal = await db.insert(meals).values({ familyId: family.id, name: "A" }).returning();
    await db.insert(mealIngredients).values({ mealId: meal[0]!.id, ingredientId: rice[0]!.id, quantity: "1", unit: "cup" });
    const [list] = await db.insert(groceryLists).values({
      familyId: family.id, name: "L", startDate: "2026-07-06", endDate: "2026-07-06",
      createdByUserId: user.id, updatedByUserId: user.id,
    }).returning();
    await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-07-08", slot: "dinner", mealId: meal[0]!.id,
      createdByUserId: user.id, updatedByUserId: user.id,
    });

    mockClerkUser(clerkUserId);
    const req = new Request(`http://x/api/grocery/lists/${list!.id}`, {
      method: "PATCH",
      body: JSON.stringify({ endDate: "2026-07-12" }),
    });
    const res = await patchList(req, { params: Promise.resolve({ id: list!.id }) });
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm test tests/integration/api-grocery-lists.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/grocery/lists/'[id]'/route.ts tests/integration/api-grocery-lists.test.ts
git commit -m "feat(api): GET + PATCH + DELETE /api/grocery/lists/[id]"
```

---

## Task 12: `POST /api/grocery/lists/[id]/regenerate`

**Files:**
- Create: `src/app/api/grocery/lists/[id]/regenerate/route.ts`
- Create: `tests/integration/api-grocery-regenerate.test.ts`

- [ ] **Step 1: Implement**

Create `src/app/api/grocery/lists/[id]/regenerate/route.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { withFamily } from "@/lib/auth/with-family";
import { NotFoundError } from "@/lib/auth/errors";
import { db } from "@/lib/db/client";
import { groceryLists, groceryListItems, ingredients } from "@/lib/db/schema";
import { regenerateList } from "@/lib/grocery/regenerate";
import { serializeDetail, serializeItem } from "@/lib/grocery/serialize";

type Ctx = { params: Promise<{ id: string }> };

export const POST = apiHandler<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const { familyId, userId } = await withFamily();
  const [list] = await db
    .select()
    .from(groceryLists)
    .where(and(eq(groceryLists.id, id), eq(groceryLists.familyId, familyId)));
  if (!list) throw new NotFoundError("Grocery list not found");

  await regenerateList(id, userId);

  const [fresh] = await db.select().from(groceryLists).where(eq(groceryLists.id, id));
  const rows = await db
    .select({
      id: groceryListItems.id, listId: groceryListItems.listId,
      ingredientId: groceryListItems.ingredientId, displayText: groceryListItems.displayText,
      quantity: groceryListItems.quantity, unit: groceryListItems.unit,
      category: groceryListItems.category, source: groceryListItems.source,
      checked: groceryListItems.checked, checkedAt: groceryListItems.checkedAt,
      checkedByUserId: groceryListItems.checkedByUserId,
      sourceScheduleEntryIds: groceryListItems.sourceScheduleEntryIds,
      sortOrder: groceryListItems.sortOrder,
      createdAt: groceryListItems.createdAt, updatedAt: groceryListItems.updatedAt,
      ingredientName: ingredients.name,
    })
    .from(groceryListItems)
    .leftJoin(ingredients, eq(groceryListItems.ingredientId, ingredients.id))
    .where(eq(groceryListItems.listId, id));
  return serializeDetail(fresh!, rows.map(serializeItem));
});
```

- [ ] **Step 2: Write an integration test** covering:
- Regenerate on a list with no changes returns the same items.
- Regenerate after a schedule edit reflects the new derivation.
- Regenerate preserves manual items.
- 404 on cross-family list id.

- [ ] **Step 3: Run tests and commit**

```bash
pnpm test tests/integration/api-grocery-regenerate.test.ts
git add src/app/api/grocery/lists/'[id]'/regenerate/route.ts tests/integration/api-grocery-regenerate.test.ts
git commit -m "feat(api): POST /api/grocery/lists/[id]/regenerate"
```

---

## Task 13: Manual items — POST + PATCH + DELETE

**Files:**
- Create: `src/app/api/grocery/lists/[id]/items/route.ts`
- Create: `src/app/api/grocery/lists/[id]/items/[itemId]/route.ts`
- Create: `tests/integration/api-grocery-items.test.ts`

- [ ] **Step 1: Implement the collection route (POST manual add)**

Create `src/app/api/grocery/lists/[id]/items/route.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { withFamily } from "@/lib/auth/with-family";
import { NotFoundError, ValidationError } from "@/lib/auth/errors";
import { db } from "@/lib/db/client";
import { groceryLists, groceryListItems, ingredients } from "@/lib/db/schema";
import { CreateGroceryItemSchema } from "@/lib/validation/grocery";
import { normalizeUnit } from "@/lib/units/normalize";
import { serializeItem } from "@/lib/grocery/serialize";

type Ctx = { params: Promise<{ id: string }> };

export const POST = apiHandler<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const { familyId } = await withFamily();
  const [list] = await db
    .select()
    .from(groceryLists)
    .where(and(eq(groceryLists.id, id), eq(groceryLists.familyId, familyId)));
  if (!list) throw new NotFoundError("Grocery list not found");

  const body = await req.json();
  const input = CreateGroceryItemSchema.parse(body);

  if (input.ingredientId) {
    const [ing] = await db
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(and(eq(ingredients.id, input.ingredientId), eq(ingredients.familyId, familyId)));
    if (!ing) throw new NotFoundError("Ingredient not found");
  }

  const [row] = await db
    .insert(groceryListItems)
    .values({
      listId: id,
      ingredientId: input.ingredientId ?? null,
      displayText: input.displayText ?? null,
      quantity: input.quantity !== undefined ? String(input.quantity) : null,
      unit: normalizeUnit(input.unit ?? null),
      category: input.category,
      source: "manual",
    })
    .returning();
  if (!row) throw new ValidationError("Insert failed");

  const [withName] = await db
    .select({
      id: groceryListItems.id, listId: groceryListItems.listId,
      ingredientId: groceryListItems.ingredientId, displayText: groceryListItems.displayText,
      quantity: groceryListItems.quantity, unit: groceryListItems.unit,
      category: groceryListItems.category, source: groceryListItems.source,
      checked: groceryListItems.checked, checkedAt: groceryListItems.checkedAt,
      checkedByUserId: groceryListItems.checkedByUserId,
      sourceScheduleEntryIds: groceryListItems.sourceScheduleEntryIds,
      sortOrder: groceryListItems.sortOrder,
      createdAt: groceryListItems.createdAt, updatedAt: groceryListItems.updatedAt,
      ingredientName: ingredients.name,
    })
    .from(groceryListItems)
    .leftJoin(ingredients, eq(groceryListItems.ingredientId, ingredients.id))
    .where(eq(groceryListItems.id, row.id));
  return serializeItem(withName!);
});
```

- [ ] **Step 2: Implement the item route (PATCH + DELETE)**

Create `src/app/api/grocery/lists/[id]/items/[itemId]/route.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { withFamily } from "@/lib/auth/with-family";
import { NotFoundError } from "@/lib/auth/errors";
import { db } from "@/lib/db/client";
import { groceryLists, groceryListItems, ingredients } from "@/lib/db/schema";
import { UpdateGroceryItemSchema } from "@/lib/validation/grocery";
import { normalizeUnit } from "@/lib/units/normalize";
import { serializeItem } from "@/lib/grocery/serialize";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

async function loadItemOrThrow(itemId: string, listId: string, familyId: string) {
  const [row] = await db
    .select({ item: groceryListItems, list: groceryLists })
    .from(groceryListItems)
    .innerJoin(groceryLists, eq(groceryListItems.listId, groceryLists.id))
    .where(
      and(
        eq(groceryListItems.id, itemId),
        eq(groceryListItems.listId, listId),
        eq(groceryLists.familyId, familyId),
      ),
    );
  if (!row) throw new NotFoundError("Item not found");
  return row.item;
}

export const PATCH = apiHandler<Ctx>(async (req, ctx) => {
  const { id, itemId } = await ctx.params;
  const { familyId, userId } = await withFamily();
  await loadItemOrThrow(itemId, id, familyId);

  const body = await req.json();
  const input = UpdateGroceryItemSchema.parse(body);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.displayText !== undefined) patch.displayText = input.displayText;
  if (input.quantity !== undefined) patch.quantity = input.quantity !== null ? String(input.quantity) : null;
  if (input.unit !== undefined) patch.unit = input.unit !== null ? normalizeUnit(input.unit) : null;
  if (input.category !== undefined) patch.category = input.category;
  if (input.checked !== undefined) {
    patch.checked = input.checked;
    patch.checkedAt = input.checked ? new Date() : null;
    patch.checkedByUserId = input.checked ? userId : null;
  }

  await db.update(groceryListItems).set(patch).where(eq(groceryListItems.id, itemId));

  const [row] = await db
    .select({
      id: groceryListItems.id, listId: groceryListItems.listId,
      ingredientId: groceryListItems.ingredientId, displayText: groceryListItems.displayText,
      quantity: groceryListItems.quantity, unit: groceryListItems.unit,
      category: groceryListItems.category, source: groceryListItems.source,
      checked: groceryListItems.checked, checkedAt: groceryListItems.checkedAt,
      checkedByUserId: groceryListItems.checkedByUserId,
      sourceScheduleEntryIds: groceryListItems.sourceScheduleEntryIds,
      sortOrder: groceryListItems.sortOrder,
      createdAt: groceryListItems.createdAt, updatedAt: groceryListItems.updatedAt,
      ingredientName: ingredients.name,
    })
    .from(groceryListItems)
    .leftJoin(ingredients, eq(groceryListItems.ingredientId, ingredients.id))
    .where(eq(groceryListItems.id, itemId));
  return serializeItem(row!);
});

export const DELETE = apiHandler<Ctx>(async (_req, ctx) => {
  const { id, itemId } = await ctx.params;
  const { familyId } = await withFamily();
  await loadItemOrThrow(itemId, id, familyId);
  await db.delete(groceryListItems).where(eq(groceryListItems.id, itemId));
  return null;
});
```

- [ ] **Step 3: Write integration tests** covering:
- POST manual → source is `manual`, checked is false.
- POST with unit "tbsp." → stored as "tbsp".
- PATCH `checked: true` populates `checked_at` + `checked_by_user_id`.
- PATCH `checked: false` clears both.
- DELETE removes the row.
- Tenant scoping: cross-family list/item returns 404.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm test tests/integration/api-grocery-items.test.ts
git add src/app/api/grocery/lists/'[id]'/items tests/integration/api-grocery-items.test.ts
git commit -m "feat(api): manual items + check-off"
```

---

## Task 14: `POST /api/grocery/lists/[id]/carry-over`

**Files:**
- Create: `src/app/api/grocery/lists/[id]/carry-over/route.ts`
- Create: `tests/integration/api-grocery-carry-over.test.ts`

- [ ] **Step 1: Implement**

Create `src/app/api/grocery/lists/[id]/carry-over/route.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { withFamily } from "@/lib/auth/with-family";
import { NotFoundError, ValidationError } from "@/lib/auth/errors";
import { db } from "@/lib/db/client";
import { groceryLists } from "@/lib/db/schema";
import { CarryOverSchema } from "@/lib/validation/grocery";
import { carryOverUnchecked } from "@/lib/grocery/carry-over";

type Ctx = { params: Promise<{ id: string }> };

export const POST = apiHandler<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const { familyId, userId } = await withFamily();

  const body = await req.json();
  const input = CarryOverSchema.parse(body);
  if (input.toListId === id) throw new ValidationError("Source and target lists must differ");

  const [src] = await db
    .select()
    .from(groceryLists)
    .where(and(eq(groceryLists.id, id), eq(groceryLists.familyId, familyId)));
  const [dst] = await db
    .select()
    .from(groceryLists)
    .where(and(eq(groceryLists.id, input.toListId), eq(groceryLists.familyId, familyId)));
  if (!src || !dst) throw new NotFoundError("List not found");

  return await carryOverUnchecked(id, input.toListId, userId);
});
```

- [ ] **Step 2: Write integration tests** covering:
- Copies only unchecked, marks them as `manual` on target.
- Source list untouched.
- 422 when source === target.
- 404 when target belongs to another family.

- [ ] **Step 3: Run and commit**

```bash
pnpm test tests/integration/api-grocery-carry-over.test.ts
git add src/app/api/grocery/lists/'[id]'/carry-over tests/integration/api-grocery-carry-over.test.ts
git commit -m "feat(api): POST /api/grocery/lists/[id]/carry-over"
```

---

## Task 15: RSC index page — `/app/grocery`

**Files:**
- Create: `src/app/app/grocery/page.tsx`

Server-side loads lists via the same helpers used by the API. Renders `<GroceryListIndex>` client island for interactivity (the "include archived" toggle plus per-card action menu).

- [ ] **Step 1: Create the page**

```tsx
import { and, count, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { withFamily } from "@/lib/auth/with-family";
import { db } from "@/lib/db/client";
import { groceryLists, groceryListItems } from "@/lib/db/schema";
import { serializeSummary } from "@/lib/grocery/serialize";
import { GroceryListIndex } from "@/components/grocery/grocery-list-index";
import { buttonVariants } from "@/components/ui/button";

type Search = { includeArchived?: string };

export default async function GroceryIndexPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const includeArchived = sp.includeArchived === "true";
  const { familyId } = await withFamily();

  const rows = await db
    .select({ list: groceryLists, itemCount: count(groceryListItems.id) })
    .from(groceryLists)
    .leftJoin(groceryListItems, eq(groceryListItems.listId, groceryLists.id))
    .where(
      includeArchived
        ? eq(groceryLists.familyId, familyId)
        : and(eq(groceryLists.familyId, familyId), eq(groceryLists.isArchived, false)),
    )
    .groupBy(groceryLists.id)
    .orderBy(desc(groceryLists.generatedAt));

  const uncheckedRows = await db
    .select({ listId: groceryListItems.listId, unchecked: count(groceryListItems.id) })
    .from(groceryListItems)
    .where(eq(groceryListItems.checked, false))
    .groupBy(groceryListItems.listId);
  const uncheckedByList = new Map(uncheckedRows.map((r) => [r.listId, Number(r.unchecked)]));

  const items = rows.map((r) =>
    serializeSummary(r.list, Number(r.itemCount), uncheckedByList.get(r.list.id) ?? 0),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Groceries</h1>
        <Link href="/app/grocery/new" className={buttonVariants({ size: "sm" })}>
          New list
        </Link>
      </div>
      <GroceryListIndex items={items} includeArchived={includeArchived} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/app/grocery/page.tsx
git commit -m "feat(grocery): RSC index page"
```

---

## Task 16: `<GroceryListIndex>` + `<GroceryListCard>` client components

**Files:**
- Create: `src/components/grocery/grocery-list-index.tsx`
- Create: `src/components/grocery/grocery-list-card.tsx`

- [ ] **Step 1: Create `<GroceryListCard>`**

```tsx
"use client";
import Link from "next/link";
import { format } from "date-fns";
import type { GroceryListSummaryDto } from "@/lib/grocery/types";

export function GroceryListCard({ item }: { item: GroceryListSummaryDto }) {
  const progress = item.itemCount === 0 ? 0 : Math.round(((item.itemCount - item.uncheckedCount) / item.itemCount) * 100);
  return (
    <Link
      href={`/app/grocery/${item.id}`}
      className="block rounded-lg border p-4 hover:bg-muted transition"
    >
      <div className="flex items-baseline justify-between">
        <div className="font-medium">{item.name}</div>
        <div className="text-xs text-muted-foreground">
          {format(new Date(item.startDate), "MMM d")} → {format(new Date(item.endDate), "MMM d")}
        </div>
      </div>
      <div className="mt-2 text-sm text-muted-foreground">
        {item.itemCount - item.uncheckedCount} of {item.itemCount} checked ({progress}%)
        {item.isArchived ? " · archived" : ""}
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Create `<GroceryListIndex>`**

```tsx
"use client";
import { useRouter, useSearchParams } from "next/navigation";
import type { GroceryListSummaryDto } from "@/lib/grocery/types";
import { GroceryListCard } from "./grocery-list-card";

export function GroceryListIndex({
  items,
  includeArchived,
}: {
  items: GroceryListSummaryDto[];
  includeArchived: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function toggleArchived() {
    const next = new URLSearchParams(params);
    if (includeArchived) next.delete("includeArchived");
    else next.set("includeArchived", "true");
    router.replace(`?${next.toString()}`);
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No grocery lists yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={toggleArchived}
        className="text-xs text-muted-foreground underline"
      >
        {includeArchived ? "Hide archived" : "Show archived"}
      </button>
      <div className="grid gap-3">
        {items.map((item) => (
          <GroceryListCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/grocery/grocery-list-index.tsx src/components/grocery/grocery-list-card.tsx
git commit -m "feat(grocery): list index cards"
```

---

## Task 17: `<DateRangePicker>` + `<GroceryListForm>` + `/app/grocery/new`

**Files:**
- Create: `src/components/grocery/date-range-picker.tsx`
- Create: `src/components/grocery/grocery-list-form.tsx`
- Create: `src/app/app/grocery/new/page.tsx`

- [ ] **Step 1: Create `<DateRangePicker>`**

Preset chips ("This week", "Next week") + fallback custom range. Uses `weekStartFor` from `@/lib/schedule/week` to align presets to the family's week-start.

```tsx
"use client";
import { useState } from "react";
import { addDays } from "date-fns";
import { formatISODate, weekStartFor } from "@/lib/schedule/week";
import { Button } from "@/components/ui/button";

type Value = { startDate: string; endDate: string };

export function DateRangePicker({
  weekStartsOn,
  value,
  onChange,
}: {
  weekStartsOn: number;
  value: Value;
  onChange: (v: Value) => void;
}) {
  const [mode, setMode] = useState<"this" | "next" | "custom">("this");

  function setThisWeek() {
    const start = weekStartFor(new Date(), weekStartsOn);
    onChange({ startDate: formatISODate(start), endDate: formatISODate(addDays(start, 6)) });
    setMode("this");
  }

  function setNextWeek() {
    const start = addDays(weekStartFor(new Date(), weekStartsOn), 7);
    onChange({ startDate: formatISODate(start), endDate: formatISODate(addDays(start, 6)) });
    setMode("next");
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button type="button" variant={mode === "this" ? "default" : "outline"} onClick={setThisWeek}>
          This week
        </Button>
        <Button type="button" variant={mode === "next" ? "default" : "outline"} onClick={setNextWeek}>
          Next week
        </Button>
        <Button type="button" variant={mode === "custom" ? "default" : "outline"} onClick={() => setMode("custom")}>
          Custom
        </Button>
      </div>
      {mode === "custom" && (
        <div className="flex gap-3">
          <label className="text-sm">
            Start
            <input
              type="date"
              value={value.startDate}
              onChange={(e) => onChange({ ...value, startDate: e.target.value })}
              className="ml-2 rounded border px-2 py-1"
            />
          </label>
          <label className="text-sm">
            End
            <input
              type="date"
              value={value.endDate}
              onChange={(e) => onChange({ ...value, endDate: e.target.value })}
              className="ml-2 rounded border px-2 py-1"
            />
          </label>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `<GroceryListForm>`**

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addDays } from "date-fns";
import { formatISODate, weekStartFor } from "@/lib/schedule/week";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "./date-range-picker";

export function GroceryListForm({ weekStartsOn }: { weekStartsOn: number }) {
  const router = useRouter();
  const initialStart = formatISODate(weekStartFor(new Date(), weekStartsOn));
  const initialEnd = formatISODate(addDays(weekStartFor(new Date(), weekStartsOn), 6));
  const [name, setName] = useState("");
  const [range, setRange] = useState({ startDate: initialStart, endDate: initialEnd });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/grocery/lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim() || undefined,
        startDate: range.startDate,
        endDate: range.endDate,
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setError(body.error?.message ?? "Failed to create list");
      setSubmitting(false);
      return;
    }
    const body = (await res.json()) as { id: string };
    router.push(`/app/grocery/${body.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-4 max-w-md">
      <label className="block">
        <span className="text-sm">Name (optional)</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Groceries"
          className="mt-1 block w-full rounded border px-3 py-2"
        />
      </label>
      <div>
        <div className="text-sm mb-1">Date range</div>
        <DateRangePicker weekStartsOn={weekStartsOn} value={range} onChange={setRange} />
      </div>
      {error && <div className="text-sm text-destructive">{error}</div>}
      <Button type="submit" disabled={submitting}>
        {submitting ? "Creating…" : "Create list"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Create `/app/grocery/new/page.tsx`**

```tsx
import { eq } from "drizzle-orm";
import { withFamily } from "@/lib/auth/with-family";
import { db } from "@/lib/db/client";
import { families } from "@/lib/db/schema";
import { GroceryListForm } from "@/components/grocery/grocery-list-form";

export default async function NewGroceryListPage() {
  const { familyId } = await withFamily();
  const [family] = await db.select().from(families).where(eq(families.id, familyId));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New grocery list</h1>
      <GroceryListForm weekStartsOn={family?.weekStartsOn ?? 0} />
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/grocery/date-range-picker.tsx src/components/grocery/grocery-list-form.tsx src/app/app/grocery/new/page.tsx
git commit -m "feat(grocery): create form + date range picker"
```

---

## Task 18: `<GroceryListView>` + category sections + item rows

**Files:**
- Create: `src/app/app/grocery/[id]/page.tsx`
- Create: `src/components/grocery/grocery-list-view.tsx`
- Create: `src/components/grocery/grocery-category-section.tsx`
- Create: `src/components/grocery/grocery-item-row.tsx`

The at-the-store view. Server component fetches the list + items joined to ingredient names, then hands off to `<GroceryListView>` which owns local optimistic state.

- [ ] **Step 1: Create the RSC page**

Create `src/app/app/grocery/[id]/page.tsx`:

```tsx
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { withFamily } from "@/lib/auth/with-family";
import { db } from "@/lib/db/client";
import { groceryLists, groceryListItems, ingredients } from "@/lib/db/schema";
import { serializeDetail, serializeItem } from "@/lib/grocery/serialize";
import { GroceryListView } from "@/components/grocery/grocery-list-view";

export default async function GroceryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { familyId } = await withFamily();
  const [list] = await db
    .select()
    .from(groceryLists)
    .where(and(eq(groceryLists.id, id), eq(groceryLists.familyId, familyId)));
  if (!list) notFound();

  const rows = await db
    .select({
      id: groceryListItems.id, listId: groceryListItems.listId,
      ingredientId: groceryListItems.ingredientId, displayText: groceryListItems.displayText,
      quantity: groceryListItems.quantity, unit: groceryListItems.unit,
      category: groceryListItems.category, source: groceryListItems.source,
      checked: groceryListItems.checked, checkedAt: groceryListItems.checkedAt,
      checkedByUserId: groceryListItems.checkedByUserId,
      sourceScheduleEntryIds: groceryListItems.sourceScheduleEntryIds,
      sortOrder: groceryListItems.sortOrder,
      createdAt: groceryListItems.createdAt, updatedAt: groceryListItems.updatedAt,
      ingredientName: ingredients.name,
    })
    .from(groceryListItems)
    .leftJoin(ingredients, eq(groceryListItems.ingredientId, ingredients.id))
    .where(eq(groceryListItems.listId, id));

  const detail = serializeDetail(list, rows.map(serializeItem));
  return <GroceryListView initial={detail} />;
}
```

- [ ] **Step 2: Create `<GroceryItemRow>` with optimistic check-off**

```tsx
"use client";
import { useState } from "react";
import type { GroceryListItemDto } from "@/lib/grocery/types";

export function GroceryItemRow({
  listId,
  item,
  onChange,
}: {
  listId: string;
  item: GroceryListItemDto;
  onChange: (next: GroceryListItemDto) => void;
}) {
  const [pending, setPending] = useState(false);

  async function toggle() {
    const optimistic = { ...item, checked: !item.checked };
    onChange(optimistic);
    setPending(true);
    try {
      const res = await fetch(`/api/grocery/lists/${listId}/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checked: optimistic.checked }),
      });
      if (!res.ok) {
        // Non-network failures revert; network failures stay optimistic (Background Sync).
        if (res.status >= 400 && res.status < 500) onChange(item);
      } else {
        const body = (await res.json()) as GroceryListItemDto;
        onChange(body);
      }
    } catch {
      // Network failure: keep optimistic, let SW queue the retry.
    } finally {
      setPending(false);
    }
  }

  const label = item.ingredientName ?? item.displayText ?? "";
  const qty = item.quantity !== null ? `${item.quantity}` : "";
  const unit = item.unit ?? "";
  const badge = item.source === "manual" ? "manual" : null;

  return (
    <div className="flex items-center gap-3 py-2">
      <input
        type="checkbox"
        checked={item.checked}
        onChange={toggle}
        disabled={pending}
        className="h-5 w-5"
        aria-label={`Check off ${label}`}
      />
      <div className={item.checked ? "line-through text-muted-foreground flex-1" : "flex-1"}>
        <span className="font-medium">{label}</span>
        {(qty || unit) && (
          <span className="ml-2 text-sm text-muted-foreground">
            {[qty, unit].filter(Boolean).join(" ")}
          </span>
        )}
        {badge && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">{badge}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `<GroceryCategorySection>`**

```tsx
"use client";
import { useState } from "react";
import type { GroceryListItemDto, IngredientCategory } from "@/lib/grocery/types";
import { GroceryItemRow } from "./grocery-item-row";

const LABELS: Record<IngredientCategory, string> = {
  produce: "Produce",
  meat: "Meat",
  dairy: "Dairy",
  pantry: "Pantry",
  frozen: "Frozen",
  bakery: "Bakery",
  other: "Other",
};

export function GroceryCategorySection({
  listId,
  category,
  items,
  onItemChange,
}: {
  listId: string;
  category: IngredientCategory;
  items: GroceryListItemDto[];
  onItemChange: (next: GroceryListItemDto) => void;
}) {
  const [open, setOpen] = useState(true);
  if (items.length === 0) return null;
  const checked = items.filter((i) => i.checked).length;

  return (
    <section className="border-t">
      <button
        type="button"
        className="flex w-full items-center justify-between py-2 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-semibold">{LABELS[category]}</span>
        <span className="text-xs text-muted-foreground">
          {checked}/{items.length}
        </span>
      </button>
      {open && (
        <div>
          {items.map((item) => (
            <GroceryItemRow key={item.id} listId={listId} item={item} onChange={onItemChange} />
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Create `<GroceryListView>`**

```tsx
"use client";
import { useState } from "react";
import type { GroceryListDetailDto, GroceryListItemDto, IngredientCategory } from "@/lib/grocery/types";
import { INGREDIENT_CATEGORIES } from "@/lib/grocery/types";
import { GroceryCategorySection } from "./grocery-category-section";

export function GroceryListView({ initial }: { initial: GroceryListDetailDto }) {
  const [detail, setDetail] = useState(initial);

  function onItemChange(next: GroceryListItemDto) {
    setDetail((d) => ({
      ...d,
      items: d.items.map((it) => (it.id === next.id ? next : it)),
    }));
  }

  const byCategory: Record<IngredientCategory, GroceryListItemDto[]> = {
    produce: [], meat: [], dairy: [], pantry: [], frozen: [], bakery: [], other: [],
  };
  for (const item of detail.items) {
    byCategory[item.category].push(item);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{detail.name}</h1>
        <p className="text-sm text-muted-foreground">
          {detail.startDate} → {detail.endDate}
          {" · "}
          {detail.itemCount - detail.uncheckedCount}/{detail.itemCount} checked
        </p>
      </div>
      {INGREDIENT_CATEGORIES.map((c) => (
        <GroceryCategorySection
          key={c}
          listId={detail.id}
          category={c}
          items={byCategory[c]}
          onItemChange={onItemChange}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/app/grocery/'[id]'/page.tsx src/components/grocery/grocery-list-view.tsx src/components/grocery/grocery-category-section.tsx src/components/grocery/grocery-item-row.tsx
git commit -m "feat(grocery): at-the-store view with optimistic check-off"
```

---

## Task 19: `<ManualItemForm>`

**Files:**
- Create: `src/components/grocery/manual-item-form.tsx`
- Modify: `src/components/grocery/grocery-list-view.tsx` (mount the form + wire adds into state)

Manual-add UI. Reuses `<IngredientCombobox>` from Phase 1 so users may link to an existing ingredient or type free text.

- [ ] **Step 1: Create the form**

```tsx
"use client";
import { useState } from "react";
import type { GroceryListItemDto, IngredientCategory } from "@/lib/grocery/types";
import { INGREDIENT_CATEGORIES } from "@/lib/grocery/types";
import { Button } from "@/components/ui/button";

const LABELS: Record<IngredientCategory, string> = {
  produce: "Produce", meat: "Meat", dairy: "Dairy",
  pantry: "Pantry", frozen: "Frozen", bakery: "Bakery", other: "Other",
};

export function ManualItemForm({
  listId,
  onAdd,
}: {
  listId: string;
  onAdd: (next: GroceryListItemDto) => void;
}) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState<IngredientCategory>("other");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setPending(true);
    setError(null);
    const res = await fetch(`/api/grocery/lists/${listId}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayText: text.trim(), category }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setError(body.error?.message ?? "Failed to add");
      setPending(false);
      return;
    }
    const row = (await res.json()) as GroceryListItemDto;
    onAdd(row);
    setText("");
    setPending(false);
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add item…"
        className="flex-1 rounded border px-3 py-2 text-sm"
      />
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value as IngredientCategory)}
        className="rounded border px-2 py-2 text-sm"
      >
        {INGREDIENT_CATEGORIES.map((c) => (
          <option key={c} value={c}>{LABELS[c]}</option>
        ))}
      </select>
      <Button type="submit" size="sm" disabled={pending || !text.trim()}>Add</Button>
      {error && <div className="text-sm text-destructive">{error}</div>}
    </form>
  );
}
```

- [ ] **Step 2: Mount it in `<GroceryListView>`** by inserting after the header block:

```tsx
import { ManualItemForm } from "./manual-item-form";
// ...
function onAdd(row: GroceryListItemDto) {
  setDetail((d) => ({ ...d, items: [...d.items, row] }));
}
// ... in JSX, between the header and the sections:
<ManualItemForm listId={detail.id} onAdd={onAdd} />
```

- [ ] **Step 3: Commit**

```bash
git add src/components/grocery/manual-item-form.tsx src/components/grocery/grocery-list-view.tsx
git commit -m "feat(grocery): manual item form"
```

---

## Task 20: `<RegenerateButton>` + `<CarryOverDialog>`

**Files:**
- Create: `src/components/grocery/regenerate-button.tsx`
- Create: `src/components/grocery/carry-over-dialog.tsx`
- Modify: `src/components/grocery/grocery-list-view.tsx`

- [ ] **Step 1: Create `<RegenerateButton>`**

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function RegenerateButton({ listId }: { listId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  async function run() {
    setPending(true);
    const res = await fetch(`/api/grocery/lists/${listId}/regenerate`, { method: "POST" });
    setPending(false);
    if (res.ok) router.refresh();
    setConfirming(false);
  }

  if (!confirming) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
        Refresh
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">
        Refresh derived items? Manual items and check-offs are preserved.
      </span>
      <Button type="button" size="sm" onClick={run} disabled={pending}>
        {pending ? "…" : "Confirm"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Create `<CarryOverDialog>`**

```tsx
"use client";
import { useEffect, useState } from "react";
import type { GroceryListSummaryDto } from "@/lib/grocery/types";
import { Button } from "@/components/ui/button";

export function CarryOverDialog({
  listId,
  onComplete,
}: {
  listId: string;
  onComplete: (added: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [others, setOthers] = useState<GroceryListSummaryDto[]>([]);
  const [target, setTarget] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/grocery/lists")
      .then((r) => r.json())
      .then((body: { items: GroceryListSummaryDto[] }) => {
        setOthers(body.items.filter((l) => l.id !== listId));
      })
      .catch(() => setError("Could not load lists"));
  }, [open, listId]);

  async function run() {
    if (!target) return;
    setPending(true);
    setError(null);
    const res = await fetch(`/api/grocery/lists/${listId}/carry-over`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toListId: target }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setError(body.error?.message ?? "Failed");
      setPending(false);
      return;
    }
    const body = (await res.json()) as { added: number };
    onComplete(body.added);
    setOpen(false);
    setPending(false);
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Carry over unchecked
      </Button>
    );
  }

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="text-sm">Copy unchecked items to another list as manual entries.</div>
      <select
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        className="rounded border px-2 py-1 text-sm"
      >
        <option value="">Pick a target list…</option>
        {others.map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
      {error && <div className="text-sm text-destructive">{error}</div>}
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={run} disabled={!target || pending}>
          {pending ? "…" : "Carry over"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire both into `<GroceryListView>`**

Insert a toolbar row between the header and the manual-item form:

```tsx
import { RegenerateButton } from "./regenerate-button";
import { CarryOverDialog } from "./carry-over-dialog";
// ...
<div className="flex flex-wrap gap-2">
  <RegenerateButton listId={detail.id} />
  <CarryOverDialog listId={detail.id} onComplete={() => { /* toast could go here */ }} />
</div>
```

- [ ] **Step 4: Commit**

```bash
git add src/components/grocery/regenerate-button.tsx src/components/grocery/carry-over-dialog.tsx src/components/grocery/grocery-list-view.tsx
git commit -m "feat(grocery): regenerate + carry-over UI"
```

---

## Task 21: `<OfflineIndicator>` + `useOnlineStatus` hook

**Files:**
- Create: `src/hooks/use-online-status.ts`
- Create: `src/components/grocery/offline-indicator.tsx`
- Modify: `src/app/app/layout.tsx` (mount the indicator inside the app shell)

- [ ] **Step 1: Create the hook**

```ts
"use client";
import { useEffect, useState } from "react";

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    function on() { setOnline(true); }
    function off() { setOnline(false); }
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}
```

- [ ] **Step 2: Create the indicator**

```tsx
"use client";
import { useEffect, useState } from "react";
import { useOnlineStatus } from "@/hooks/use-online-status";

export function OfflineIndicator() {
  const online = useOnlineStatus();
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const data = ev.data as { type?: string; count?: number } | undefined;
      if (data?.type === "grocery-checkoff-queue-status" && typeof data.count === "number") {
        setQueued(data.count);
      }
    }
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);

  if (online && queued === 0) return null;

  return (
    <div className="fixed bottom-4 inset-x-4 mx-auto max-w-sm rounded-lg border bg-background/90 backdrop-blur px-3 py-2 text-sm shadow">
      {!online && "Offline — check-offs will sync when you reconnect."}
      {online && queued > 0 && `Syncing ${queued} update${queued > 1 ? "s" : ""}…`}
    </div>
  );
}
```

- [ ] **Step 3: Mount the indicator in the app layout**

In `src/app/app/layout.tsx`, add:

```tsx
import { OfflineIndicator } from "@/components/grocery/offline-indicator";
// ...
<InstallPrompt />
<OfflineIndicator />
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/use-online-status.ts src/components/grocery/offline-indicator.tsx src/app/app/layout.tsx
git commit -m "feat(grocery): offline indicator + online-status hook"
```

---

## Task 22: SW runtime cache — grocery, calendar, meal detail SWR

**Files:**
- Modify: `next.config.ts`

Replace the Phase 0 `runtimeCaching` block. The existing block used a catch-all regex including `grocery-list` (a placeholder). Now that the actual routes exist, wire them explicitly.

- [ ] **Step 1: Update `next.config.ts`**

Replace the `workboxOptions` block with:

```ts
workboxOptions: {
  runtimeCaching: [
    // Grocery reads — aisle-critical
    {
      urlPattern: /^\/app\/grocery\/[^/]+$/,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "grocery-pages",
        expiration: { maxAgeSeconds: 60 * 60 * 24 },
      },
    },
    {
      urlPattern: /^\/api\/grocery\/lists(\/[^/]+)?$/,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "grocery-api",
        expiration: { maxAgeSeconds: 60 * 60 * 24 },
      },
    },
    // Calendar reads
    {
      urlPattern: /^\/app\/calendar/,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "calendar-pages",
        expiration: { maxAgeSeconds: 60 * 60 * 24 },
      },
    },
    {
      urlPattern: /^\/api\/schedule\/week/,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "schedule-api",
        expiration: { maxAgeSeconds: 60 * 60 * 24 },
      },
    },
    // Meal detail
    {
      urlPattern: /^\/app\/meals\/[^/]+$/,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "meal-pages",
        expiration: { maxAgeSeconds: 60 * 60 * 24 },
      },
    },
    {
      urlPattern: /^\/api\/meals\/[^/]+$/,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "meal-api",
        expiration: { maxAgeSeconds: 60 * 60 * 24 },
      },
    },
    // Existing me / profiles reads (retain from Phase 0)
    {
      urlPattern: /^\/api\/(me|profiles).*/,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "auth-api",
        expiration: { maxAgeSeconds: 60 * 60 * 24 },
      },
    },
    // Static images
    {
      urlPattern: /\.(?:png|jpg|jpeg|svg|webp|ico)$/,
      handler: "CacheFirst",
      options: {
        cacheName: "images",
        expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 },
      },
    },
  ],
},
```

- [ ] **Step 2: Rebuild the SW locally and smoke-test in a private window**

```bash
pnpm build
pnpm start
```

Load `/app/grocery/<id>` while online, toggle DevTools "Offline," reload — expect the page to still render.

- [ ] **Step 3: Commit**

```bash
git add next.config.ts
git commit -m "feat(pwa): SWR caching for grocery, calendar, meal detail"
```

---

## Task 23: SW background sync — check-off queue

**Files:**
- Modify: `next.config.ts`

Register `workbox-background-sync` for `PATCH /api/grocery/lists/*/items/*`. The Workbox route wraps a `NetworkOnly` strategy — offline PATCH failures queue in IndexedDB and replay on the browser's `sync` event.

- [ ] **Step 1: Install the plugin**

```bash
pnpm add workbox-background-sync
```

- [ ] **Step 2: Extend `workboxOptions` in `next.config.ts`**

Add above the existing `runtimeCaching` block:

```ts
workboxOptions: {
  importScripts: undefined,
  disableDevLogs: true,
  // Register a custom route via the `manifestTransforms`/`additionalManifestEntries` hook is not
  // sufficient here — instead use the `_next-pwa` `swSrc` option to inject a script snippet.
  // We opt for the simpler `runtimeCaching` NetworkOnly + BackgroundSyncPlugin combo:
  runtimeCaching: [
    {
      urlPattern: ({ url, request }) =>
        request.method === "PATCH" &&
        /^\/api\/grocery\/lists\/[^/]+\/items\/[^/]+$/.test(url.pathname),
      handler: "NetworkOnly",
      method: "PATCH",
      options: {
        backgroundSync: {
          name: "grocery-checkoff-queue",
          options: { maxRetentionTime: 24 * 60 }, // minutes
        },
      },
    },
    // ...existing runtimeCaching entries...
  ],
},
```

*(Note: the `@ducanh2912/next-pwa` `runtimeCaching` config accepts a `backgroundSync` option that is forwarded to Workbox's registerRoute; if the version pinned does not accept a functional `urlPattern`, swap to the equivalent regex. Confirm during implementation by reading `node_modules/@ducanh2912/next-pwa/dist/index.d.ts`.)*

- [ ] **Step 3: Verify the offline check-off flow manually**

```bash
pnpm build && pnpm start
```

- Open `/app/grocery/<id>` in DevTools.
- Set network to "Offline."
- Tap a checkbox — UI updates optimistically.
- Confirm the request appears in the Application → Background Services → Background Sync panel as queued.
- Set network back to "Online."
- Confirm the queue drains and the item stays checked after a hard reload.

- [ ] **Step 4: Commit**

```bash
git add next.config.ts package.json pnpm-lock.yaml
git commit -m "feat(pwa): background sync for grocery check-off PATCH"
```

---

## Task 24: Nav — add "Groceries" link

**Files:**
- Modify: `src/app/app/layout.tsx`

- [ ] **Step 1: Add the link between Calendar and Recipes**

Replace the `<nav>` block:

```tsx
<nav className="flex items-center gap-4">
  <Link href="/app/calendar" className="text-sm">Calendar</Link>
  <Link href="/app/grocery" className="text-sm">Groceries</Link>
  <Link href="/app/meals" className="text-sm">Recipes</Link>
  <Link href="/app/settings/profiles" className="text-sm">Profiles</Link>
  <UserButton />
</nav>
```

- [ ] **Step 2: Commit**

```bash
git add src/app/app/layout.tsx
git commit -m "feat(nav): add Groceries link"
```

---

## Task 25: E2E — grocery flow

**Files:**
- Modify: `tests/e2e/smoke.spec.ts`

Extend the smoke suite with a grocery flow gated on the existing `E2E_USER_EMAIL` env var. Preconditions: the phase 2 calendar flow already produces scheduled meals for the test week; the grocery test reuses them.

- [ ] **Step 1: Append the grocery block**

```ts
test("plan a week and shop it", async ({ page }) => {
  test.skip(!process.env.E2E_USER_EMAIL, "requires seeded user");

  await page.goto("/app/calendar");
  // Plan a meal on Mon dinner using the Phase 2 helpers already exercised above.
  // ... (rely on Phase 2's setup helpers)

  await page.goto("/app/grocery");
  await page.getByRole("link", { name: "New list" }).click();

  await page.getByRole("button", { name: "This week" }).click();
  await page.getByRole("button", { name: /Create list/ }).click();

  await expect(page).toHaveURL(/\/app\/grocery\/[^/]+/);
  await expect(page.getByText("Produce")).toBeVisible();

  // Check off the first row
  const firstCheckbox = page.locator('input[type="checkbox"]').first();
  await firstCheckbox.check();
  await page.reload();
  await expect(firstCheckbox).toBeChecked();

  // Add a manual item
  await page.getByPlaceholder("Add item…").fill("paper towels");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("paper towels")).toBeVisible();

  // Regenerate
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("paper towels")).toBeVisible();
});
```

- [ ] **Step 2: Run locally against the dev server**

```bash
pnpm exec playwright test tests/e2e/smoke.spec.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/smoke.spec.ts
git commit -m "test(e2e): grocery list plan → check → manual → regenerate"
```

---

## Task 26: Final verification

- [ ] **Step 1: Full test suite**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all green.

- [ ] **Step 2: Manual mobile smoke — iOS Safari + Android Chrome**

Load the production build (or preview deploy) on a real device and walk through:

1. Create a grocery list from "this week."
2. Confirm derived items appear grouped by category.
3. Add a manual item.
4. Check off two items; reload; state persists.
5. Toggle airplane mode. Check off another item — instant UI update.
6. Restore connectivity. Confirm the "Syncing…" indicator appears briefly and the item remains checked after a hard reload.
7. Edit the schedule (add another meal). Return to the list, tap Refresh, confirm the aggregation reflects the change.
8. Carry unchecked items into a second list.

- [ ] **Step 3: Update the phase status in the memory / status recap**

Report completion in the PR body — the Phase 3 exit-criteria checklist from the design spec is the source of truth.

---

## Deferred / follow-up

Not in scope for this phase (per the design spec §16):

- Per-serving math on schedule-derived quantities.
- Unit conversion (cups ↔ tablespoons ↔ grams).
- Fuzzy or full-text ingredient matching in aggregation.
- Custom aisle order per family.
- Store-scoped lists.
- Offline queueing for anything other than check-off.
- Real-time multi-shopper sync.
- Cost estimation from `price_history` — waits on Phase 5.
- Printable list — Phase 6's PDF export owns that.

These are documented as future revisits, not TODOs on this branch.
