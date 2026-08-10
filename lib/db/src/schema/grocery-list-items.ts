import { pgTable, serial, text, real, date, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const groceryListItemsTable = pgTable("grocery_list_items", {
  id: serial("id").primaryKey(),
  weekStart: date("week_start", { mode: "string" }).notNull(),
  name: text("name").notNull(),
  quantity: real("quantity"),
  unit: text("unit"),
  category: text("category", {
    enum: ["produce", "dairy", "meat_seafood", "bakery", "pantry", "frozen", "beverages", "spices", "other"],
  }).notNull(),
  checked: boolean("checked").notNull().default(false),
  source: text("source", { enum: ["auto", "manual"] }).notNull().default("manual"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertGroceryListItemSchema = createInsertSchema(groceryListItemsTable).omit({ id: true, createdAt: true });
export type InsertGroceryListItem = z.infer<typeof insertGroceryListItemSchema>;
export type GroceryListItem = typeof groceryListItemsTable.$inferSelect;
