import { pgTable, serial, text, integer, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { recipesTable } from "./recipes";

export const mealPlanEntriesTable = pgTable("meal_plan_entries", {
  id: serial("id").primaryKey(),
  date: date("date", { mode: "string" }).notNull(),
  mealSlot: text("meal_slot", { enum: ["breakfast", "lunch", "dinner", "snack"] }).notNull(),
  recipeId: integer("recipe_id")
    .notNull()
    .references(() => recipesTable.id, { onDelete: "cascade" }),
  servings: integer("servings"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMealPlanEntrySchema = createInsertSchema(mealPlanEntriesTable).omit({ id: true, createdAt: true });
export type InsertMealPlanEntry = z.infer<typeof insertMealPlanEntrySchema>;
export type MealPlanEntry = typeof mealPlanEntriesTable.$inferSelect;
