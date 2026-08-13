ALTER TABLE "recipes" ADD COLUMN "calories" integer;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "protein_g" real;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "carbs_g" real;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "fat_g" real;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "nutrition_source" text;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "nutrition_extras" jsonb;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "nutrition_input_hash" text;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "nutrition_updated_at" timestamp with time zone;