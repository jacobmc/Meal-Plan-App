# Phase 1 — Recipe Library: Design

**Status:** Draft for review
**Date:** 2026-05-11
**Scope:** First product slice on top of the Phase 0 foundation. Adds the meal inventory (recipe library) with optional structured ingredients, search, and free-text tagging. Sequential predecessor to Phase 2 (weekly calendar).

---

## 1. Summary

A family can build, search, tag, and edit a library of text-only recipes. Each recipe has free-form Markdown instructions and an ingredient list that mixes structured catalog references with free-text rows. The ingredient catalog grows organically as users type ingredients into recipes — there is no separate management UI in this phase.

Images, recipe duplication, archive UI, and the planning grid are explicit deferrals.

## 2. Exit criteria

A seeded family can:

- Create 20+ meals with any mix of structured / free-text ingredients.
- Search the list by name (prefix match).
- Filter the list by one or more tags (ANDed).
- View a meal's rendered Markdown instructions.
- Edit and delete existing meals.

Mobile smoke pass on iOS Safari and Android Chrome covers each of the above.

## 3. Scope decisions

### In scope

- `meals`, `ingredients`, `meal_ingredients` tables with the hybrid (structured-or-free-text) model.
- `meals.tags text[]` for free-text tagging and tag filtering.
- `/app/meals` list + `/app/meals/new` + `/app/meals/[id]` + `/app/meals/[id]/edit` routes.
- REST API under `/api/meals/*` and `/api/ingredients` (list-and-create only).
- Inline ingredient autocomplete with "Create new ingredient «foo»" affordance.
- Markdown editor: Edit/Preview tabbed textarea.
- Tag input: chip-style with autocomplete from existing family tag values.
- Search by meal name (prefix, case-insensitive, server-side).
- Tag filter chips on the list.
- Empty states for "no results" and "no recipes yet".

### Out of scope (deferred)

- Images / Vercel Blob upload — Phase 1.5.
- Recipe duplicate / "save as new".
- Archive UI (the `is_archived` column ships, no UI surfaces it).
- Ingredient edit / delete UI.
- Bulk import (CSV, URL scraping, recipe-site extraction).
- Reordering ingredients across meals (within-meal reorder *is* in scope, see §7).
- Fuzzy / full-text search. Prefix only.
- Pagination. The list returns all non-archived meals; revisit when families exceed ~500 recipes.

## 4. Data model

Three new tables. Schema matches the Phase 0 overview spec verbatim, with the addition of `meals.tags`.

```sql
CREATE TABLE meals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id             uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  description           text,
  instructions          text,                 -- markdown source
  prep_time_minutes     int,
  cook_time_minutes     int,
  servings              int,
  source_url            text,
  image_url             text,                 -- reserved, unused in Phase 1
  tags                  text[] NOT NULL DEFAULT '{}',
  is_archived           boolean NOT NULL DEFAULT false,
  created_by_user_id    uuid REFERENCES users(id),
  updated_by_user_id    uuid REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX meals_family_name_idx ON meals (family_id, lower(name));
CREATE INDEX meals_family_active_idx ON meals (family_id) WHERE NOT is_archived;
CREATE INDEX meals_tags_gin_idx ON meals USING GIN (tags);

CREATE TABLE ingredients (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id             uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  default_unit          text,
  category              text NOT NULL
    CHECK (category IN ('produce','meat','dairy','pantry','frozen','bakery','other')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ingredients_family_name_uniq
  ON ingredients (family_id, lower(name));
CREATE INDEX ingredients_family_category_idx
  ON ingredients (family_id, category);

CREATE TABLE meal_ingredients (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_id               uuid NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  ingredient_id         uuid REFERENCES ingredients(id) ON DELETE RESTRICT,
  display_text          text,
  quantity              numeric(10,3),
  unit                  text,
  sort_order            int NOT NULL DEFAULT 0,
  CHECK (ingredient_id IS NOT NULL OR display_text IS NOT NULL)
);

CREATE INDEX meal_ingredients_meal_idx ON meal_ingredients (meal_id);
```

**Tags as `text[]`** rather than a join table: small cardinality per family, no need to enforce uniqueness across meals, and Postgres GIN handles `tags @> ARRAY[$1]` filtering cheaply. If tag operations later need their own metadata (color, description, parent), a migration to `tags` + `meal_tags` is non-breaking.

**`is_archived` ships in the schema with no UI** to avoid a migration when archive UI lands in a later phase.

**Ingredient deletion is RESTRICTed** on `meal_ingredients` so users can't orphan ingredient_id references. There's no ingredient-delete UI in this phase anyway.

**Drizzle implementation:** add `meals`, `ingredients`, `mealIngredients` to `src/lib/db/schema.ts`. Generate one migration file via `pnpm db:generate` and check it in.

## 5. API surface

All routes follow the Phase 0 conventions: `apiHandler` wrapper, `withFamily` for tenant scoping, Zod validation, JSON error envelope.

```
GET    /api/meals                          → { items: MealSummary[] }
GET    /api/meals/[id]                     → MealDetail
POST   /api/meals                          → MealDetail
PATCH  /api/meals/[id]                     → MealDetail
DELETE /api/meals/[id]                     → 204

GET    /api/meals/tags                     → { items: string[] }

GET    /api/ingredients?q=<prefix>         → { items: Ingredient[] }
POST   /api/ingredients                    → Ingredient
```

### Query params

- `GET /api/meals` accepts `q` (name prefix), `tag` (repeatable for AND filtering), and `includeArchived=true` (defaults to false). Phase 1 UI never sends `includeArchived`.
- `GET /api/ingredients` requires `q` (min 1 char). Returns up to 20 results ordered by `lower(name)`.

### Shapes

```ts
type MealSummary = {
  id: string;
  name: string;
  tags: string[];
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  servings: number | null;
  updatedAt: string;
};

type MealDetail = MealSummary & {
  description: string | null;
  instructions: string | null;
  sourceUrl: string | null;
  ingredients: MealIngredientRow[];
};

type MealIngredientRow = {
  id: string;
  ingredientId: string | null;
  ingredientName: string | null;     // joined for display when ingredientId set
  displayText: string | null;
  quantity: number | null;
  unit: string | null;
  sortOrder: number;
};

type Ingredient = {
  id: string;
  name: string;
  defaultUnit: string | null;
  category: 'produce'|'meat'|'dairy'|'pantry'|'frozen'|'bakery'|'other';
};
```

### Mutation semantics

- `POST /api/meals` writes the meal row and inserts `meal_ingredients` rows in a single transaction. Any ingredient row with `ingredientId` is FK-validated; rows with only `displayText` skip the FK.
- `PATCH /api/meals/[id]` uses **delete-and-reinsert** for `meal_ingredients` (delete all rows for the meal, then insert the new set). Simpler than diffing, acceptable at this row count.
- `DELETE /api/meals/[id]` cascades `meal_ingredients` via FK.
- `POST /api/ingredients` returns 409 on duplicate (case-insensitive) within the family.

### Zod schemas

Live alongside each route under `src/lib/validation/`. Inferred types are exported for client reuse, matching the Phase 0 pattern for profile schemas.

## 6. Routing + pages

```
/app/meals                         RSC, list + filter controls
/app/meals/new                     RSC entry, renders <MealForm />
/app/meals/[id]                    RSC, detail view (rendered Markdown)
/app/meals/[id]/edit               RSC entry, renders <MealForm initial={...} />
```

The list page reads URL search params (`?q=&tag=&tag=`) and queries the DB directly server-side via the same `withFamily` helper used elsewhere. Filters update the URL via `router.replace()` so back-button and shareable links work.

Search input is debounced 200 ms client-side before pushing to the URL.

## 7. UI components

New components under `src/components/`:

| Component | Purpose |
|---|---|
| `meal-list.tsx` | Client island over the RSC-rendered list; handles search + tag chips and pushes URL changes. |
| `meal-list-item.tsx` | One row in the list — name, tags, prep+cook total, servings, action menu. |
| `meal-form.tsx` | Create / edit form. Sections: basics, ingredients, instructions, tags. Uses `react-hook-form` + Zod resolver. |
| `meal-ingredient-row.tsx` | Single sub-form row inside `meal-form`. Wraps `ingredient-combobox` + quantity + unit + drag handle. |
| `ingredient-combobox.tsx` | Autocomplete input. Debounced fetch to `/api/ingredients?q=`. "Create new" affordance when no match. |
| `markdown-editor.tsx` | Edit/Preview tabs. Plain `react-markdown` for rendering. No toolbar in Phase 1. |
| `markdown-view.tsx` | Read-only renderer used on detail pages. |
| `tag-input.tsx` | Chip input with autocomplete from `/api/meals/tags`. |

### Drag-to-reorder ingredients

Within a single meal's ingredients list, users can reorder rows. Use `@dnd-kit/sortable` (small dep, RSC-safe). Sort order persists via the `sort_order` column.

### Empty states

- **No recipes yet:** centered card on the list page, "Build your first recipe" CTA → `/app/meals/new`.
- **Filters match nothing:** inline message above the (empty) list, "No recipes match. Clear filters?" with a button that clears the URL params.

## 8. Search + filter behavior

- **Search:** server-side `WHERE lower(name) LIKE lower($1 || '%')`. Prefix-only.
- **Tag filter:** `WHERE tags @> $1` where `$1` is the array of selected tags. Multiple tags AND together.
- **Default ordering:** `ORDER BY lower(name)` ascending.
- **Hidden archived:** `WHERE NOT is_archived` always applied unless `includeArchived=true` (never used in Phase 1 UI).

## 9. Validation + errors

### Zod limits

- `name`: 1–120 chars, trimmed.
- `description`: ≤500 chars.
- `instructions`: ≤20 000 chars (~5 pages of recipe).
- `tags`: ≤10 items, each 1–30 chars, lowercased + trimmed before save.
- `prep_time_minutes`, `cook_time_minutes`: 0–999, optional.
- `servings`: 1–99, optional.
- `source_url`: valid URL via `z.string().url()`, optional.
- `meal_ingredients`: 0–50 rows; each row must have `ingredientId` or `displayText` (Zod refinement matches the DB CHECK).
- `quantity`: 0–9999.99 with up to 3 decimals.
- `unit`: ≤30 chars.

### Error codes

Reuse the Phase 0 envelope (`unauthorized`, `forbidden`, `not_found`, `validation_failed`, `conflict`, `internal`). New code paths:

- `not_found` — meal id missing or family mismatch.
- `conflict` — ingredient name collision within family (case-insensitive).
- `validation_failed` — Zod failure; the response `details` includes the flattened field errors so the client can surface per-field messages.

## 10. Testing strategy

### Unit (Vitest)

- Zod schemas for meals and ingredients — both happy paths and limit edges.
- Tag normalization (lowercase, trim, dedupe).
- Ingredient name normalization (trim, collapse interior whitespace, case-preserve display).

### Integration (Vitest + DB)

- `POST /api/meals` with mixed structured + free-text ingredients writes both correctly.
- `PATCH /api/meals` deletes and reinserts ingredient rows.
- `DELETE /api/meals` cascades `meal_ingredients`.
- `GET /api/meals` filters by `q` (prefix), `tag` (multi-AND), and respects `is_archived`.
- `GET /api/meals/tags` deduplicates and returns lowercase tags only.
- `GET /api/ingredients?q=` returns ≤20, prefix-match, family-scoped.
- `POST /api/ingredients` returns 409 on case-insensitive duplicate.
- Tenant scoping: family A can't read or write any of family B's meals, ingredients, or meal_ingredients.

### E2E (Playwright)

Extend the existing smoke suite (`tests/e2e/smoke.spec.ts`) — gated on `E2E_USER_EMAIL` like the auth test:

1. Sign in.
2. Create a meal with one structured ingredient and one free-text ingredient.
3. Confirm the meal appears in the list.
4. Search for it by name prefix.
5. Filter by its tag.
6. Edit it (change name, add a tag).
7. Delete it.

## 11. Dependencies to add

- `react-markdown` — instructions rendering.
- `@dnd-kit/core` + `@dnd-kit/sortable` — ingredient row reordering.

`react-hook-form` and `@hookform/resolvers` are already installed (Phase 0).

## 12. Migration order

One Drizzle migration file is enough for the whole phase:

1. Create `meals`, `ingredients`, `meal_ingredients`.
2. Create indexes (`meals_family_name_idx`, `meals_family_active_idx`, `meals_tags_gin_idx`, `ingredients_family_name_uniq`, `ingredients_family_category_idx`, `meal_ingredients_meal_idx`).

Migration runs in CI (Phase 0 workflow) and in every Vercel deploy (Phase 0 `vercel-build` script).

## 13. Assumptions to revisit

- **Delete-and-reinsert for `meal_ingredients` on PATCH.** Acceptable at <50 rows per meal; revisit when concurrent editing or revision history becomes relevant.
- **Prefix-only search.** Move to full-text or fuzzy if users complain about not finding meals by middle words.
- **No pagination on `GET /api/meals`.** Add cursor pagination if families exceed ~500 recipes.
- **`tags` as `text[]`.** Acceptable until tags need their own metadata.
- **Single-user editing assumption.** No last-write-wins UI affordance in Phase 1; latest PATCH wins silently.

## 14. Out of scope for this spec

- Wireframes / pixel-level UI mocks (will be drawn during implementation).
- Exact column lengths and additional indexes beyond those listed.
- Phase 2 / 3 implications — those phases get their own specs.
- Production seed data — the Phase 0 seed script is enough; users build their own meals.
