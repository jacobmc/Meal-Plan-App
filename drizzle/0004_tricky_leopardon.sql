CREATE TABLE "grocery_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"ingredient_id" uuid,
	"display_text" text,
	"quantity" numeric(10, 3),
	"unit" text,
	"category" text NOT NULL,
	"source" text NOT NULL,
	"checked" boolean DEFAULT false NOT NULL,
	"checked_at" timestamp with time zone,
	"checked_by_user_id" uuid,
	"source_schedule_entry_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grocery_list_items_source_check" CHECK ("grocery_list_items"."source" in ('derived','manual')),
	CONSTRAINT "grocery_list_items_category_check" CHECK ("grocery_list_items"."category" in ('produce','meat','dairy','pantry','frozen','bakery','other')),
	CONSTRAINT "grocery_list_items_display_or_ingredient" CHECK ("grocery_list_items"."ingredient_id" is not null or "grocery_list_items"."display_text" is not null),
	CONSTRAINT "grocery_list_items_checked_at_consistency" CHECK (("grocery_list_items"."checked" and "grocery_list_items"."checked_at" is not null) or (not "grocery_list_items"."checked" and "grocery_list_items"."checked_at" is null))
);
--> statement-breakpoint
CREATE TABLE "grocery_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_regenerated_at" timestamp with time zone,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grocery_lists_date_range_check" CHECK ("grocery_lists"."end_date" >= "grocery_lists"."start_date")
);
--> statement-breakpoint
ALTER TABLE "grocery_list_items" ADD CONSTRAINT "grocery_list_items_list_id_grocery_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."grocery_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_list_items" ADD CONSTRAINT "grocery_list_items_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_list_items" ADD CONSTRAINT "grocery_list_items_checked_by_user_id_users_id_fk" FOREIGN KEY ("checked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_lists" ADD CONSTRAINT "grocery_lists_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_lists" ADD CONSTRAINT "grocery_lists_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_lists" ADD CONSTRAINT "grocery_lists_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grocery_list_items_list_idx" ON "grocery_list_items" USING btree ("list_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grocery_list_items_derived_uniq" ON "grocery_list_items" USING btree ("list_id","ingredient_id",coalesce("unit", '')) WHERE "grocery_list_items"."source" = 'derived' and "grocery_list_items"."ingredient_id" is not null;--> statement-breakpoint
CREATE INDEX "grocery_lists_family_idx" ON "grocery_lists" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "grocery_lists_family_active_idx" ON "grocery_lists" USING btree ("family_id") WHERE not "grocery_lists"."is_archived";