CREATE TABLE "ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"name" text NOT NULL,
	"default_unit" text,
	"category" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingredients_category_check" CHECK ("ingredients"."category" in ('produce','meat','dairy','pantry','frozen','bakery','other'))
);
--> statement-breakpoint
CREATE TABLE "meal_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meal_id" uuid NOT NULL,
	"ingredient_id" uuid,
	"display_text" text,
	"quantity" numeric(10, 3),
	"unit" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "meal_ingredients_hybrid_check" CHECK ("meal_ingredients"."ingredient_id" is not null or "meal_ingredients"."display_text" is not null)
);
--> statement-breakpoint
CREATE TABLE "meals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"instructions" text,
	"prep_time_minutes" integer,
	"cook_time_minutes" integer,
	"servings" integer,
	"source_url" text,
	"image_url" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_ingredients" ADD CONSTRAINT "meal_ingredients_meal_id_meals_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_ingredients" ADD CONSTRAINT "meal_ingredients_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meals" ADD CONSTRAINT "meals_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meals" ADD CONSTRAINT "meals_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meals" ADD CONSTRAINT "meals_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ingredients_family_name_uniq" ON "ingredients" USING btree ("family_id",lower("name"));--> statement-breakpoint
CREATE INDEX "ingredients_family_category_idx" ON "ingredients" USING btree ("family_id","category");--> statement-breakpoint
CREATE INDEX "meal_ingredients_meal_idx" ON "meal_ingredients" USING btree ("meal_id");--> statement-breakpoint
CREATE INDEX "meals_family_name_idx" ON "meals" USING btree ("family_id",lower("name"));--> statement-breakpoint
CREATE INDEX "meals_family_active_idx" ON "meals" USING btree ("family_id") WHERE not "meals"."is_archived";--> statement-breakpoint
CREATE INDEX "meals_tags_gin_idx" ON "meals" USING gin ("tags");