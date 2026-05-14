CREATE TYPE "public"."meal_slot" AS ENUM('breakfast', 'lunch', 'dinner', 'snack');--> statement-breakpoint
CREATE TABLE "schedule_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"date" date NOT NULL,
	"slot" "meal_slot" NOT NULL,
	"profile_id" uuid,
	"meal_id" uuid,
	"eating_out" boolean DEFAULT false NOT NULL,
	"eating_out_cost" numeric(10, 2),
	"eating_out_label" text,
	"notes" text,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_entries_meal_xor_eatout" CHECK (not ("schedule_entries"."meal_id" is not null and "schedule_entries"."eating_out" = true)),
	CONSTRAINT "schedule_entries_eatout_fields_check" CHECK ("schedule_entries"."eating_out" = true or ("schedule_entries"."eating_out_cost" is null and "schedule_entries"."eating_out_label" is null))
);
--> statement-breakpoint
ALTER TABLE "schedule_entries" ADD CONSTRAINT "schedule_entries_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_entries" ADD CONSTRAINT "schedule_entries_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_entries" ADD CONSTRAINT "schedule_entries_meal_id_meals_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_entries" ADD CONSTRAINT "schedule_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_entries" ADD CONSTRAINT "schedule_entries_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_entries_default_uniq" ON "schedule_entries" USING btree ("family_id","date","slot") WHERE "schedule_entries"."profile_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_entries_override_uniq" ON "schedule_entries" USING btree ("family_id","date","slot","profile_id") WHERE "schedule_entries"."profile_id" is not null;--> statement-breakpoint
CREATE INDEX "schedule_entries_family_date_idx" ON "schedule_entries" USING btree ("family_id","date");