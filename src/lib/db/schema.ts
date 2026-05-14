import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  smallint,
  boolean,
  primaryKey,
  uniqueIndex,
  index,
  integer,
  numeric,
  date,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const mealSlot = pgEnum("meal_slot", ["breakfast", "lunch", "dinner", "snack"]);

export const families = pgTable("families", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("America/New_York"),
  weekStartsOn: smallint("week_starts_on").notNull().default(0),
  clerkOrgId: text("clerk_org_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull().unique(),
    email: text("email"),
    displayName: text("display_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clerkIdx: uniqueIndex("users_clerk_user_id_idx").on(table.clerkUserId),
  }),
);

export const familyUsers = pgTable(
  "family_users",
  {
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.familyId, table.userId] }),
    userIdx: index("family_users_user_id_idx").on(table.userId),
  }),
);

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    color: text("color").notNull().default("#94a3b8"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: smallint("sort_order").notNull().default(0),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    familyIdx: index("profiles_family_id_idx").on(table.familyId),
  }),
);

export type Family = typeof families.$inferSelect;
export type NewFamily = typeof families.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type FamilyUser = typeof familyUsers.$inferSelect;
export type NewFamilyUser = typeof familyUsers.$inferInsert;
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;

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
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
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

export const scheduleEntries = pgTable(
  "schedule_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    slot: mealSlot("slot").notNull(),
    profileId: uuid("profile_id").references(() => profiles.id, { onDelete: "cascade" }),
    mealId: uuid("meal_id").references(() => meals.id, { onDelete: "set null" }),
    eatingOut: boolean("eating_out").notNull().default(false),
    eatingOutCost: numeric("eating_out_cost", { precision: 10, scale: 2 }),
    eatingOutLabel: text("eating_out_label"),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    defaultUniq: uniqueIndex("schedule_entries_default_uniq")
      .on(table.familyId, table.date, table.slot)
      .where(sql`${table.profileId} is null`),
    overrideUniq: uniqueIndex("schedule_entries_override_uniq")
      .on(table.familyId, table.date, table.slot, table.profileId)
      .where(sql`${table.profileId} is not null`),
    familyDateIdx: index("schedule_entries_family_date_idx").on(table.familyId, table.date),
    mealXorEatout: check(
      "schedule_entries_meal_xor_eatout",
      sql`not (${table.mealId} is not null and ${table.eatingOut} = true)`,
    ),
    eatoutFieldsCheck: check(
      "schedule_entries_eatout_fields_check",
      sql`${table.eatingOut} = true or (${table.eatingOutCost} is null and ${table.eatingOutLabel} is null)`,
    ),
  }),
);

export type ScheduleEntry = typeof scheduleEntries.$inferSelect;
export type NewScheduleEntry = typeof scheduleEntries.$inferInsert;
export type MealSlot = (typeof mealSlot.enumValues)[number];

void sql;
