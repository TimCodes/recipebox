import { pgTable, serial, text, integer, real, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import type { Ingredient } from "@workspace/api-zod";

export const recipesTable = pgTable("recipes", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  ingredients: jsonb("ingredients").$type<Ingredient[]>().notNull().default([]),
  instructions: text("instructions").notNull(),
  servings: integer("servings"),
  prepMinutes: integer("prep_minutes"),
  cookMinutes: integer("cook_minutes"),
  tags: text("tags").array().notNull().default([]),
  photoUrl: text("photo_url"),

  // Per-serving macros. All nullable: a recipe whose source printed no nutrition panel must
  // store nothing rather than a guess, so that a real panel and an absent one stay
  // distinguishable.
  calories: integer("calories"),
  proteinG: real("protein_g"),
  carbsG: real("carbs_g"),
  fatG: real("fat_g"),
  /** Provenance. Drives the UI label — a publisher's tested panel must never look like our estimate. */
  nutritionSource: text("nutrition_source", {
    enum: ["stated", "estimated", "computed", "manual"],
  }),
  /** Whatever the source gave beyond the four macros (fiber, sugars, sodium, ...). */
  nutritionExtras: jsonb("nutrition_extras").$type<Record<string, unknown> | null>(),
  /**
   * Per-ingredient assumptions behind a derived value. Kept so a surprising total can be
   * explained and a bad assumption spotted, instead of the estimate being an opaque number.
   */
  nutritionBreakdown: jsonb("nutrition_breakdown").$type<unknown[] | null>(),
  /**
   * Hash of the inputs the numbers describe (ingredients + servings). Staleness is derived by
   * comparing this on read, rather than a stored boolean that every write path would have to
   * remember to maintain and would eventually get wrong.
   */
  nutritionInputHash: text("nutrition_input_hash"),
  nutritionUpdatedAt: timestamp("nutrition_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRecipeSchema = createInsertSchema(recipesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRecipe = z.infer<typeof insertRecipeSchema>;
export type Recipe = typeof recipesTable.$inferSelect;
