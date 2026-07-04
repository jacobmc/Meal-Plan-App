# Phase 3 — Grocery List: Design

**Status:** Draft for review
**Date:** 2026-07-04
**Scope:** Third product slice on top of Phase 2's weekly calendar. Adds materialized grocery lists derived from the schedule, mixed with manual add-ons, with mobile "at the store" check-off and read-while-offline. Sequential predecessor to Phase 4 (spend dashboard) but does not block it — Phase 4 reads `schedule_entries`, not grocery lists.

---

## 1. Summary

A family can generate a grocery list from a chosen date range of their schedule, add their own items to it, and check items off in the kitchen or in the aisle. Multiple concurrent lists are supported (usually one, sometimes more — "this week" + "Thanksgiving"). Regenerating a list after schedule edits refreshes derived items while preserving manual items and any check-off state that still applies. The "at the store" view groups by ingredient category and works offline: reads cache stale-while-revalidate, and check-off writes queue to Background Sync so they survive dead zones in the produce aisle.

Grocery aggregation across meals uses a canonical unit map (no unit *conversion* — no cups↔grams math). Ingredients with only free-text `display_text` (no structured ingredient link) render verbatim under a "Miscellaneous" section.

Per-serving math ("we're only cooking half the recipe tonight"), fuzzy ingredient matching, and store-layout ordering are explicit deferrals.

## 2. Exit criteria

A seeded family can:

- Create a grocery list for a preset date range ("this week", "next week") or a custom range.
- Aggregate derived items from every scheduled meal (default + overrides, `meal_id IS NOT NULL`, `eating_out = false`) in the range.
- Add manual items with a category, optional quantity, and optional unit.
- Check items off; check state persists.
- Regenerate the list after schedule edits: derived items refresh, manual items and matching check-off state survive.
- Rename and archive a list. Delete a list.
- Carry unchecked items into another list ("add unchecked to next week's list").
- Load the active grocery list, the current week's schedule, and any meal detail while offline.
- Check items off while offline; the tap feels instant and the write reconciles on reconnect.

Mobile smoke pass on iOS Safari and Android Chrome covers each of the above, including one intentional flight-mode test for check-off.

## 3. Scope decisions

### In scope

- `grocery_lists` + `grocery_list_items` tables.
- Multiple concurrent lists per family. Archive-not-delete for old lists is the intended lifecycle; hard delete is available.
- Preset date-range picker (this week / next week / custom).
- Derived aggregation across scheduled meals in `[start_date, end_date]`, both defaults and overrides.
- Canonical unit normalization (string map, no unit conversion).
- Regenerate-merge: drop-and-reinsert derived rows, preserve manual rows and matching-key check-off.
- Manual item add / edit / delete.
- Check / uncheck with audit columns.
- "At the store" view: sections grouped by ingredient category, with a sticky-header collapsible layout.
- Empty states: no lists yet, empty date range (no scheduled meals), empty category.
- Offline reads: SW caches grocery detail, calendar, and meal detail via stale-while-revalidate.
- Offline writes: check-off PATCH is queued via `workbox-background-sync`; UI shows optimistic state.
- Carry-over: single action that copies unchecked items from list A into list B as manual items.
- Expand the Phase 0 `runtimeCaching` block, which currently references `grocery-list` as a placeholder pattern.

### Out of scope (deferred)

- Per-serving math. Every scheduled `(schedule_entry, meal)` contributes one full ingredient list; halving or doubling a meal is not modeled.
- Unit conversion (e.g. cups ↔ tablespoons, oz ↔ g). String-normalized units only.
- Fuzzy or full-text ingredient matching. Exact `(ingredient_id, canonical_unit)` bucketing only.
- Custom aisle ordering per family. Category order is the ingredients enum order (`produce → meat → dairy → pantry → frozen → bakery → other`).
- Store-scoped lists ("my Aldi list vs my Walmart list"). Store awareness lands in Phase 5.
- Offline queueing of anything except check-off. Create/rename/archive/manual-add all require connectivity in v1.
- Split lists across multiple shoppers with real-time sync.
- "Suggest an existing ingredient for this free-text row" — a hook is left on the misc rendering path but no UI ships this phase.
- Printable list — Phase 6's PDF export owns that surface.
- Price forecasting / cost-of-list summary — Phase 5b or later.

## 4. Data model

Two new tables. Categories mirror the `ingredients.category` enum from Phase 1.

```sql
CREATE TABLE grocery_lists (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id             uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  start_date            date NOT NULL,
  end_date              date NOT NULL,
  generated_at          timestamptz NOT NULL DEFAULT now(),
  last_regenerated_at   timestamptz,
  is_archived           boolean NOT NULL DEFAULT false,
  created_by_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grocery_lists_date_range_check CHECK (end_date >= start_date)
);

CREATE INDEX grocery_lists_family_idx ON grocery_lists (family_id);
CREATE INDEX grocery_lists_family_active_idx
  ON grocery_lists (family_id) WHERE NOT is_archived;

CREATE TABLE grocery_list_items (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id                   uuid NOT NULL REFERENCES grocery_lists(id) ON DELETE CASCADE,
  ingredient_id             uuid REFERENCES ingredients(id) ON DELETE SET NULL,
  display_text              text,
  quantity                  numeric(10,3),
  unit                      text,                                -- canonical (post-normalization)
  category                  text NOT NULL,                        -- snapshot from ingredient or user pick
  source                    text NOT NULL,                        -- 'derived' | 'manual'
  checked                   boolean NOT NULL DEFAULT false,
  checked_at                timestamptz,
  checked_by_user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  source_schedule_entry_ids uuid[] NOT NULL DEFAULT '{}',
  sort_order                integer NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grocery_list_items_source_check
    CHECK (source IN ('derived','manual')),
  CONSTRAINT grocery_list_items_category_check
    CHECK (category IN ('produce','meat','dairy','pantry','frozen','bakery','other')),
  CONSTRAINT grocery_list_items_display_or_ingredient
    CHECK (ingredient_id IS NOT NULL OR display_text IS NOT NULL),
  CONSTRAINT grocery_list_items_checked_at_consistency
    CHECK ((checked AND checked_at IS NOT NULL) OR (NOT checked AND checked_at IS NULL))
);

CREATE INDEX grocery_list_items_list_idx ON grocery_list_items (list_id);

-- Structured derived items are aggregated: at most one row per (list, ingredient, canonical unit).
-- Manual items and display-text-only derived items (Misc) are intentionally unconstrained — they
-- may legitimately repeat.
CREATE UNIQUE INDEX grocery_list_items_derived_uniq
  ON grocery_list_items (list_id, ingredient_id, (COALESCE(unit, '')))
  WHERE source = 'derived' AND ingredient_id IS NOT NULL;
```

**Why `unit` on the item row and not just referenced from meal_ingredients:** derived items are the *aggregation* output, so the unit stored is the canonical form after normalization. The originals are traceable via `source_schedule_entry_ids` → `schedule_entries` → `meals` → `meal_ingredients` if forensic detail is ever needed.

**Why `category` denormalized onto the item row:** two reasons. (1) manual items need a category and don't have an `ingredient_id`. (2) if a user reclassifies an ingredient mid-shopping-trip (unlikely but possible), the on-list layout should stay stable — a shopping trip is a bounded ceremony.

**Why `ingredient_id ON DELETE SET NULL`:** deleting an ingredient the user has already checked off shouldn't erase the check-off history. The row becomes a display-text-only orphan and the UI renders whatever `display_text` was populated at generation time. Manual items with `display_text` are already in that shape.

**Why `COALESCE(unit,'')` in the partial unique index:** Postgres treats NULLs as distinct in a normal unique index, so `(list, ingredient, NULL)` would collide with itself and produce multiple no-unit rows. `COALESCE` collapses that into a single deterministic aggregation bucket. The `NULLS NOT DISTINCT` syntax (PG15+) would also work; the `COALESCE` form is explicit and travels with Drizzle-generated SQL cleanly.

**No unique on `grocery_list_items` for misc (display-text-only) derived rows.** Aggregation is by exact `display_text` string case-insensitively in the app layer, and only one row per string is inserted per generation — so a runtime unique index would be belt-and-braces. Skipped for simplicity.

**Drizzle implementation:** add `groceryLists` and `groceryListItems` to `src/lib/db/schema.ts`. One migration file via `pnpm db:generate`. Verify the partial unique index survives generation — Drizzle has been patchy about `COALESCE`-in-index predicates. Hand-edit if it strips them.

## 5. Aggregation algorithm

The single source of truth for "what do we need to buy for these meals." Lives at `src/lib/grocery/aggregate.ts`.

```ts
export type DerivedItem = {
  ingredientId: string | null;
  displayText: string | null;
  quantity: number | null;
  unit: string | null;                 // canonical (normalized)
  category: IngredientCategory;
  sourceScheduleEntryIds: string[];
};

export async function generateDerivedItems(
  familyId: string,
  startDate: string,
  endDate: string,
): Promise<DerivedItem[]>;
```

### Algorithm

```
1. instances = SELECT id, meal_id
               FROM schedule_entries
               WHERE family_id = ?
                 AND date BETWEEN ? AND ?
                 AND meal_id IS NOT NULL
                 AND eating_out = false;

2. Load meal_ingredients for the distinct meal_ids in one query, joined to ingredients
   for name + category + default_unit.

3. For each (instance, meal_ingredient row):

   a. If ingredient_id IS NOT NULL AND quantity IS NOT NULL AND unit IS NOT NULL:
        key = (ingredient_id, normalizeUnit(unit))
        bucket[key].quantity += quantity
        bucket[key].sourceScheduleEntryIds.push(instance.id)
        bucket[key].category = ingredient.category
        bucket[key].unit = canonical form

   b. If ingredient_id IS NOT NULL AND (quantity IS NULL OR unit IS NULL):
        key = (ingredient_id, null)
        # unitless bucket — a single row per ingredient with no quantity summed
        bucket[key].quantity = null
        bucket[key].unit = null
        bucket[key].sourceScheduleEntryIds.push(instance.id)
        bucket[key].category = ingredient.category

   c. If ingredient_id IS NULL (display_text-only row):
        key = ('misc', normalizeText(display_text))         # case-insensitive dedupe
        bucket[key].displayText = display_text (first-seen wording preserved)
        bucket[key].category = 'other'                       # misc goes under "Other"
        bucket[key].sourceScheduleEntryIds.push(instance.id)

4. Return bucket.values() as DerivedItem[].
```

**Trace-through examples:**

- Two meals, both call for 2 cups of onion (structured). Result: one row, `ingredient=onion, quantity=4, unit=cup, category=produce, sourceScheduleEntryIds=[e1, e2]`.
- One meal calls for "1 tbsp olive oil" and another for "1 tablespoon olive oil" (structured, unit strings differ). Both normalize to `tbsp`. Result: one row, `quantity=2, unit=tbsp`.
- One meal calls for 1 cup of onion, another for 500 g onion. Two buckets (cup vs g) — result: two rows for onion. **Not** unit-converted.
- A meal ingredient references `onion` with no quantity/unit ("some onion, to taste"). Result: one unitless row per ingredient regardless of how many meals do this. Displays as "Onion".
- A meal ingredient is `{display_text: "a handful of basil"}` in two meals. Case-insensitive text-normalized bucket: one Misc row with the original wording preserved and both entry ids captured.

**Query strategy:** two round-trips — one for schedule entries, one for meal_ingredients joined to ingredients. Total row count is bounded by (7 days × 4 slots × ~1.x defaults+overrides) × (~10 ingredients per meal) ≈ 300 rows worst-case for a normal week. No optimization needed in v1.

## 6. Regenerate-merge algorithm

Runs on: `POST /api/grocery/lists/[id]/regenerate`, and implicitly on `PATCH /api/grocery/lists/[id]` when `start_date` or `end_date` changes.

Lives at `src/lib/grocery/regenerate.ts`.

```
regenerate(listId, actorUserId):
  list = SELECT * FROM grocery_lists WHERE id = ? [family-scoped]
  current = SELECT * FROM grocery_list_items WHERE list_id = ? AND source = 'derived'
  newItems = generateDerivedItems(list.family_id, list.start_date, list.end_date)

  # Preserve check-off state for still-derived items.
  # Match key mirrors the aggregation key from §5:
  #   structured   → `${ingredientId}:${unit ?? ''}`
  #   misc (no id) → `misc:${normalizeText(displayText)}`
  checkedMap = new Map()
  for row in current:
    if row.checked:
      checkedMap.set(matchKey(row), {
        checkedAt: row.checked_at,
        checkedByUserId: row.checked_by_user_id,
      })

  BEGIN TRANSACTION
    DELETE FROM grocery_list_items WHERE list_id = ? AND source = 'derived'

    for item in newItems:
      preserved = checkedMap.get(matchKey(item))
      INSERT grocery_list_items (
        ...,
        source = 'derived',
        checked = preserved != null,
        checked_at = preserved?.checkedAt,
        checked_by_user_id = preserved?.checkedByUserId
      )

    UPDATE grocery_lists
    SET last_regenerated_at = now(), updated_by_user_id = ?
    WHERE id = ?
  COMMIT
```

**Manual rows are never touched.** They persist as-is across regenerations.

**Quantity is always overwritten** on regenerate (per your call in the design conversation). Users who hand-edit a derived row's quantity and then regenerate will see their edit wiped — that's by design; hand-editing derived rows is a break-the-glass action and manual add is the intended path for permanent additions.

**Concurrency note:** a single transaction, single-writer within a family in v1. No optimistic-concurrency token on the list. If two family members regenerate simultaneously, last write wins on the row set; the derived-uniq partial index makes bad interleavings deterministic rather than corrupt.

## 7. Unit normalization

A pure string-normalization function at `src/lib/units/normalize.ts`. No unit conversion — only alias collapse.

```ts
export function normalizeUnit(raw: string | null): string | null;
```

### Canonical map

```
tsp     ← teaspoon, teaspoons, tsp, t
tbsp    ← tablespoon, tablespoons, tbsp, T
cup     ← cup, cups, c
oz      ← ounce, ounces, oz
lb      ← pound, pounds, lb, lbs
g       ← gram, grams, g
kg      ← kilogram, kilograms, kg
ml      ← milliliter, milliliters, ml
l       ← liter, liters, l
each    ← each, ct, count, whole
can     ← can, cans
pkg     ← package, packages, pkg, pack
clove   ← clove, cloves
bunch   ← bunch, bunches
slice   ← slice, slices
sprig   ← sprig, sprigs
```

- Case-insensitive match. Leading/trailing whitespace trimmed. Trailing period stripped ("tsp." → "tsp").
- No fuzzy matching. No pluralization heuristic beyond the explicit alias list — `strawberries` stays `strawberries` (it's not a unit anyway; unit strings are user-supplied on `meal_ingredients.unit`).
- Anything not in the map is passed through unchanged. Aggregation treats passthrough strings as their own bucket, so nonstandard units still aggregate self-consistently within a list.
- `null` and empty string both return `null`.

## 8. API surface

All routes follow the established conventions: `apiHandler` wrapper, `withFamily` for tenant scoping, Zod validation, JSON error envelope. Mutations return the updated resource.

```
GET    /api/grocery/lists                              → { items: GroceryListSummary[] }
POST   /api/grocery/lists                              → GroceryListDetail   # creates + generates
GET    /api/grocery/lists/[id]                         → GroceryListDetail
PATCH  /api/grocery/lists/[id]                         → GroceryListDetail
DELETE /api/grocery/lists/[id]                         → 204

POST   /api/grocery/lists/[id]/regenerate              → GroceryListDetail
POST   /api/grocery/lists/[id]/carry-over              → { added: number }

POST   /api/grocery/lists/[id]/items                   → GroceryListItem   # manual add
PATCH  /api/grocery/lists/[id]/items/[itemId]          → GroceryListItem   # check / edit
DELETE /api/grocery/lists/[id]/items/[itemId]          → 204
```

### Query params

- `GET /api/grocery/lists` accepts `includeArchived=true` (defaults false).

### Shapes

```ts
type IngredientCategory =
  'produce'|'meat'|'dairy'|'pantry'|'frozen'|'bakery'|'other';

type GroceryListSummary = {
  id: string;
  name: string;
  startDate: string;               // YYYY-MM-DD
  endDate: string;                 // YYYY-MM-DD
  isArchived: boolean;
  generatedAt: string;
  lastRegeneratedAt: string | null;
  itemCount: number;
  uncheckedCount: number;
  updatedAt: string;
};

type GroceryListDetail = GroceryListSummary & {
  items: GroceryListItem[];        // grouped in UI, flat here
};

type GroceryListItem = {
  id: string;
  ingredientId: string | null;
  ingredientName: string | null;   // joined for display when ingredientId set
  displayText: string | null;
  quantity: number | null;
  unit: string | null;             // canonical
  category: IngredientCategory;
  source: 'derived' | 'manual';
  checked: boolean;
  checkedAt: string | null;
  sourceScheduleEntryIds: string[];
  sortOrder: number;
  updatedAt: string;
};
```

### Mutation semantics

- **POST `/api/grocery/lists`**: body `{ name, startDate, endDate }`. Creates the list row, immediately runs `generateDerivedItems`, inserts derived rows, returns the full detail. `name` defaults server-side to `"Groceries — MMM D → MMM D"` if omitted.
- **PATCH `/api/grocery/lists/[id]`**: body may include `name`, `isArchived`, `startDate`, `endDate`. If either date changes, the endpoint runs the regenerate-merge algorithm atomically before returning. Rename-and-archive never trigger regeneration.
- **DELETE `/api/grocery/lists/[id]`**: hard-delete, cascades to items via FK.
- **POST `/api/grocery/lists/[id]/regenerate`**: explicit trigger, returns the refreshed detail.
- **POST `/api/grocery/lists/[id]/carry-over`**: body `{ toListId }`. Reads all `checked = false` items from source list (both derived and manual), inserts them into `toListId` as **manual** rows (so they survive the target list's next regenerate). Source list is untouched. Returns `{ added }`.
- **POST `/api/grocery/lists/[id]/items`**: body `{ displayText, quantity?, unit?, category }` — `ingredientId` is optional and, if provided, must be family-scoped. `source = 'manual'` is forced server-side. Unit is normalized on write.
- **PATCH `/api/grocery/lists/[id]/items/[itemId]`**: body may include `checked`, `displayText`, `quantity`, `unit`, `category`. Setting `checked: true` populates `checked_at = now()` and `checked_by_user_id`; setting `checked: false` clears both. Editing a derived row's `displayText` / `quantity` / `unit` is allowed but will be overwritten by the next regenerate.
- **DELETE `/api/grocery/lists/[id]/items/[itemId]`**: hard-deletes. Deleting a derived item does *not* prevent the next regenerate from recreating it.

### Zod schemas

Live under `src/lib/validation/grocery.ts`. Types exported for client reuse.

## 9. Routing + pages

```
/app/grocery                        RSC, list index (active lists + link to archived)
/app/grocery/new                    RSC entry, renders <GroceryListForm />
/app/grocery/[id]                   RSC, at-the-store view
```

Nav gets a "Groceries" link between "Calendar" and "Recipes".

The index page reads `?includeArchived=` from search params. The detail page reads the list id and calls the same server helpers used by the API, no HTTP hop.

The empty-schedule case (a list is generated over a range with no scheduled meals) renders "This range has nothing scheduled — add manual items or plan meals first" with links to `/app/calendar` and the manual-add form open by default.

## 10. UI components

New components under `src/components/grocery/`:

| Component | Purpose |
|---|---|
| `grocery-list-index.tsx` | Client island over the RSC-rendered list of lists; renders cards with progress (checked/total), date range, and last-regenerated timestamp. |
| `grocery-list-card.tsx` | One row in the index. Action menu: rename, archive, delete, carry-over. |
| `grocery-list-form.tsx` | Create / edit form. Name + date-range picker. `react-hook-form` + Zod. |
| `date-range-picker.tsx` | Preset chips ("This week", "Next week") + a custom date-range input. Presets read `families.week_starts_on` for alignment. |
| `grocery-list-view.tsx` | Detail page container. Renders sections in category order. |
| `grocery-category-section.tsx` | Collapsible section per category. Header shows category label + checked/total for that section. |
| `grocery-item-row.tsx` | Checkbox + name + quantity + unit + optional source badge (small icon for `derived` vs `manual`). Long-press opens edit dialog. Uses optimistic UI. |
| `manual-item-form.tsx` | Inline form at the top of each category or under a floating "+" button. Reuses `ingredient-combobox` from Phase 1 so users can link to a structured ingredient if they like. |
| `regenerate-button.tsx` | Confirm dialog: "Refresh derived items? Your check-offs and manual items will be preserved." |
| `carry-over-dialog.tsx` | Pick a target list (dropdown of other non-archived lists), confirm, submit. |
| `offline-indicator.tsx` | Small toast / banner shown when `navigator.onLine === false`, plus a "Syncing…" state when the SW replays queued writes. |

### Section layout

Category order is fixed: `produce → meat → dairy → pantry → frozen → bakery → other`. Misc (`ingredient_id IS NULL`) items land in "other". Sections with zero items collapse and hide by default. Section headers stick to the top of the viewport while scrolling within their section.

### Row edit affordances

- **Tap the checkbox:** toggles `checked`. Optimistic. On write failure, snapshot revert with a toast.
- **Tap the row body:** opens an inline edit sheet with quantity / unit / category. Manual items also get "delete."
- **Long-press:** shortcut to delete.

### Empty states

- **No lists yet:** centered card on `/app/grocery`, "Build your first list" CTA → `/app/grocery/new`.
- **List generated over an empty schedule range:** message + manual-add prompt (§9).
- **All checked:** subtle "🛒 done" banner replacing the header when every item is checked; no confetti (per house style — call this out for reviewers).
- **Empty category:** hidden by default; a footer "Show empty categories" toggle reveals them for manual-add convenience.

## 11. Offline strategy

### Reads (SW runtime cache)

Extend `next.config.ts` `runtimeCaching`:

- `/app/grocery/[id]` and `/api/grocery/lists/*` — StaleWhileRevalidate, 24 h expiry. **Highest priority: the aisle case.**
- `/app/calendar` and `/api/schedule/week` — StaleWhileRevalidate, 24 h.
- `/app/meals/[id]` and `/api/meals/[id]` — StaleWhileRevalidate, 24 h.
- Static assets (already covered by Phase 0's `.png/.jpg` rule).

The Phase 0 `runtimeCaching` block already includes a placeholder pattern (`grocery-list`) that never matched a real endpoint. Phase 3 replaces that block with the above — this is a wire-up item, not a new dep.

### Writes (Background Sync)

Only `PATCH /api/grocery/lists/*/items/*` participates. All other writes require connectivity in v1.

- Register `workbox-background-sync` `BackgroundSyncPlugin` with a `grocery-checkoff-queue`.
- Register a `NetworkOnly` route for the PATCH URL pattern, wrapping the plugin. When the fetch fails (offline / 5xx), Workbox queues the request in IndexedDB and replays on `sync` event.
- The client optimistically updates the row's `checked` state in local state before the fetch resolves. On visible failure (non-network, e.g. 400/403), it snapshot-reverts and toasts. On network failure, it stays optimistic — the queue handles replay.
- On queue drain (`sync` event completes), the client's cached `/api/grocery/lists/[id]` response revalidates via SWR, so the DB truth catches up on the next foreground.
- A small "Syncing N updates…" banner appears when `navigator.serviceWorker.controller` posts a queue-status message.

**Idempotency:** each PATCH sends `{ checked: true }` or `{ checked: false }`. Replaying an already-applied PATCH produces the same result. No idempotency key needed.

**Conflict:** if two family members check the same item offline and both queues drain later, the later PATCH wins on `checked_at`. No merge UI; last write wins is acceptable — the item is checked either way.

### What doesn't queue

Create list, rename, delete, archive, regenerate, carry-over, manual-item add / edit / delete — all require online. Attempting one offline shows a "Reconnect to save" toast without queuing. Rationale: check-off is the aisle-critical write; everything else is a kitchen-table operation.

### PWA install / update flow

Unchanged from Phase 0. Install prompt, no forced update on version change (Phase 0 pattern).

## 12. Validation + errors

### Zod limits

- `name`: 1–80 chars, trimmed.
- `startDate`, `endDate`: ISO date. `endDate >= startDate`. Span ≤ 90 days (Zod refinement).
- `displayText`: 1–120 chars, trimmed.
- `quantity`: 0–9999.999 with up to 3 decimals.
- `unit`: ≤30 chars, then run through `normalizeUnit` server-side before write.
- `category`: enum matching the ingredients enum.
- `checked`: boolean.
- Item body must have `ingredientId` or `displayText` (mirrors the DB CHECK).
- Carry-over `toListId`: UUID, family-scoped, distinct from source `id`.

### Error codes

Reuse the standard envelope. New code paths:

- `validation_failed` — date-range span too long, negative range, unknown category, missing ingredient/displayText.
- `not_found` — list or item id missing or family mismatch.
- `conflict` — `POST /api/grocery/lists/[id]/items` targeting a `(list, ingredient, unit)` that already has a derived row. The client should PATCH the existing row instead. **This 409 uses the derived-uniq partial index as its source of truth.**
- `forbidden` — cross-family list id.

## 13. Testing strategy

### Unit (Vitest)

- `normalizeUnit`: every alias in the map, casing variants, `.` stripping, empty/null inputs, passthrough for unknown strings.
- `generateDerivedItems`: with synthetic schedule rows —
  - empty range → `[]`;
  - all eat-out → `[]`;
  - two meals sharing an ingredient with matching units → one row, summed;
  - same ingredient with mismatched units → two rows;
  - unitless meal_ingredient → one unitless row per ingredient regardless of instance count;
  - display-text-only rows → misc bucket, case-insensitive dedupe, first-seen wording preserved;
  - defaults + overrides both counted; eat-out entries skipped.
- Regenerate-merge:
  - checked-off derived row that survives the new derivation → remains checked, `checked_at` preserved;
  - checked-off derived row whose key no longer appears in the new derivation → row removed (with the check-off), which is the intended "we're not buying this anymore" behavior;
  - manual rows unchanged across regenerate.
- Carry-over:
  - copies only `checked = false` rows;
  - target rows written as `source = 'manual'`;
  - source list untouched.
- Zod refinements: date-range span, ingredient-or-display-text, unit-normalization on write.

### Integration (Vitest + DB)

- `POST /api/grocery/lists` writes the list and initial derived items in one transaction.
- `POST /api/grocery/lists/[id]/regenerate` returns the refreshed detail with preserved check-off.
- `PATCH /api/grocery/lists/[id]` with a new `endDate` triggers regenerate atomically.
- `POST /api/grocery/lists/[id]/items` writes a manual row with `source='manual'`.
- `PATCH /api/grocery/lists/[id]/items/[itemId]` toggles checked and populates `checked_at`.
- `POST /api/grocery/lists/[id]/carry-over` inserts unchecked source rows into target as manual.
- Tenant scoping: family A cannot read or mutate family B's lists or items.
- Cross-tenant FK: manual-item POST with a foreign `ingredientId` returns `not_found`.
- Derived-uniq partial index prevents a second POST of the same `(list, ingredient, unit)` derived row (409).

### E2E (Playwright)

Extend `tests/e2e/smoke.spec.ts` — signed-in, calendar populated by the Phase 2 flow:

1. Navigate to `/app/grocery`.
2. Create a list for "this week."
3. Confirm derived items appear grouped by category.
4. Add a manual item under Produce.
5. Check off two items and reload; state persists.
6. Edit the schedule (add another meal that uses onions), return to the list, click "Refresh."
7. Confirm the onion row quantity changed and the check-off on unrelated items remained.
8. Carry unchecked items into a second list; verify they appear as manual there.

### Offline smoke (manual, one-time per release)

Not automated in v1. Documented in the phase README:

1. Load `/app/grocery/[id]` online.
2. Toggle airplane mode.
3. Check off three items — UI responds instantly.
4. Restore connectivity.
5. Confirm the "Syncing…" indicator appears briefly and the items remain checked after a fresh reload.

## 14. Dependencies to add

- `workbox-background-sync` — Background Sync plugin for check-off queue. `@ducanh2912/next-pwa` uses Workbox under the hood; verify the version pinning during implementation.
- No new client-runtime deps expected. `date-fns`, `react-hook-form`, `@hookform/resolvers`, `@dnd-kit/*` are all present.

## 15. Migration order

One Drizzle migration file:

1. `CREATE TABLE grocery_lists` with the date-range CHECK.
2. `CREATE INDEX grocery_lists_family_idx`, `grocery_lists_family_active_idx`.
3. `CREATE TABLE grocery_list_items` with all CHECK constraints.
4. `CREATE INDEX grocery_list_items_list_idx`.
5. `CREATE UNIQUE INDEX grocery_list_items_derived_uniq` with the `COALESCE(unit,'')` predicate.

Migration runs in CI and on Vercel deploy via the existing `vercel-build` script.

## 16. Assumptions to revisit

- **No per-serving math.** Each `(schedule_entry, meal)` contributes the meal's full ingredient list once. Revisit when the first user complains that a doubled recipe produced the wrong shopping quantity.
- **String-only unit normalization, no conversion.** Two meals asking for onion in different units yield two rows. Revisit if the same ingredient consistently splits across units in the same family's data.
- **Misc lands in "Other" category.** Revisit if users want display-text items to inherit a category from context (heuristic: adjacent structured ingredient's category), which is more UX work than it sounds.
- **Regenerate overwrites derived quantities.** Explicitly designed; revisit only if users repeatedly report losing hand-edits.
- **Fixed category order.** Custom aisle order is a "should" per the overview. Revisit after real shopping trips.
- **Only check-off queues offline.** Revisit if users report kitchen-scenario writes failing offline more than aisle writes.
- **Carry-over creates manual rows on target.** Preserves the items across the next regenerate. Revisit if users want carry-over to reuse the existing derived row when the target list's date range would generate the same one.
- **Categories denormalized onto items.** Revisit if bulk recategorization becomes a workflow.
- **No optimistic-concurrency token on the list.** Revisit if multi-shopper editing produces confusing outcomes.
- **`families.timezone` still not user-editable.** The date-range picker reads it for "this week / next week"; if it's wrong, the range is wrong. Same call as Phase 2.

## 17. Out of scope for this spec

- Wireframes / pixel-level UI mocks (drawn during implementation).
- Phase 4 spend dashboard — it reads `schedule_entries`, unaffected by this phase.
- Phase 5 receipt / price integration — grocery items do not link to receipts in v1.
- Phase 6 printable list — the PDF export owns that surface.
- Real-time multi-shopper sync.
- Nutrition roll-up over a list.
- Cost estimation from `price_history` (waits on Phase 5).
