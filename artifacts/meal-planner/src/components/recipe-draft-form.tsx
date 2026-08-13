import { useFieldArray } from 'react-hook-form';
import * as z from 'zod';
import { IngredientCategory } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Loader2, Plus, Trash2, Check } from 'lucide-react';

/**
 * Shared review/edit form for an AI-produced recipe draft — used by both the
 * "Import Recipe" (PDF/text extraction) and "Generate Recipe" (AI/RAG) flows so
 * they present a consistent editable-draft experience before saving.
 */
export const ingredientSchema = z.object({
  name: z.string().min(1, "Ingredient name is required"),
  quantity: z.coerce.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  category: z.nativeEnum(IngredientCategory),
});

export const draftSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  servings: z.coerce.number().min(1).nullable().optional(),
  prepMinutes: z.coerce.number().min(0).nullable().optional(),
  cookMinutes: z.coerce.number().min(0).nullable().optional(),
  tags: z.string(),
  ingredients: z.array(ingredientSchema).min(1, "At least one ingredient is required"),
  instructions: z.string().min(1, "Instructions are required"),
  // Carried through the review step untouched rather than edited. Extraction may have found a
  // per-serving panel in the source; without this it would be silently dropped on save.
  nutrition: z.any().optional(),
  saved: z.boolean(),
});

export type DraftValues = z.infer<typeof draftSchema>;

export function DraftCard({
  index,
  control,
  isSaved,
  isSaving,
  onRemove,
  onSave,
  saveLabel = "Save to Recipe Box",
}: {
  index: number;
  control: any;
  isSaved: boolean;
  isSaving: boolean;
  onRemove?: () => void;
  onSave: () => void;
  saveLabel?: string;
}) {
  const { fields: ingredientFields, append: appendIngredient, remove: removeIngredient } = useFieldArray({
    control,
    name: `drafts.${index}.ingredients`,
  });

  return (
    <Card className={`border-border ${isSaved ? 'bg-secondary/5 border-secondary/30' : 'bg-card'}`}>
      <CardContent className="p-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <FormField
            control={control}
            name={`drafts.${index}.title`}
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormLabel className="text-base">Recipe Title</FormLabel>
                <FormControl>
                  <Input className="text-lg h-12 bg-background border-border" disabled={isSaved} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {onRemove && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mt-8 text-muted-foreground hover:text-destructive"
              onClick={onRemove}
              disabled={isSaved}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>

        <FormField
          control={control}
          name={`drafts.${index}.description`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea className="resize-none bg-background border-border h-20" disabled={isSaved} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-3 gap-4">
          <FormField
            control={control}
            name={`drafts.${index}.prepMinutes`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Prep (min)</FormLabel>
                <FormControl>
                  <Input type="number" min="0" className="bg-background border-border" disabled={isSaved} {...field} value={field.value ?? ''} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={`drafts.${index}.cookMinutes`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Cook (min)</FormLabel>
                <FormControl>
                  <Input type="number" min="0" className="bg-background border-border" disabled={isSaved} {...field} value={field.value ?? ''} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={`drafts.${index}.servings`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Servings</FormLabel>
                <FormControl>
                  <Input type="number" min="1" className="bg-background border-border" disabled={isSaved} {...field} value={field.value ?? ''} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={control}
          name={`drafts.${index}.tags`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tags</FormLabel>
              <FormControl>
                <Input placeholder="dinner, quick (comma separated)" className="bg-background border-border" disabled={isSaved} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Separator className="bg-border" />

        <div>
          <h3 className="text-lg font-serif text-foreground mb-3">Ingredients</h3>
          <div className="space-y-3">
            {ingredientFields.map((ingField, ingIndex) => (
              <div key={ingField.id} className="flex items-start gap-3 p-3 bg-background rounded-lg border border-border">
                <div className="grid grid-cols-[1fr_80px_100px_140px] gap-3 flex-1 items-start">
                  <FormField
                    control={control}
                    name={`drafts.${index}.ingredients.${ingIndex}.name`}
                    render={({ field }) => (
                      <FormItem className="space-y-1">
                        <FormControl>
                          <Input placeholder="Ingredient" className="h-10 border-border bg-card" disabled={isSaved} {...field} />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={control}
                    name={`drafts.${index}.ingredients.${ingIndex}.quantity`}
                    render={({ field }) => (
                      <FormItem className="space-y-1">
                        <FormControl>
                          <Input type="number" step="any" placeholder="Qty" className="h-10 border-border bg-card" disabled={isSaved} {...field} value={field.value ?? ''} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={control}
                    name={`drafts.${index}.ingredients.${ingIndex}.unit`}
                    render={({ field }) => (
                      <FormItem className="space-y-1">
                        <FormControl>
                          <Input placeholder="Unit" className="h-10 border-border bg-card" disabled={isSaved} {...field} value={field.value ?? ''} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={control}
                    name={`drafts.${index}.ingredients.${ingIndex}.category`}
                    render={({ field }) => (
                      <FormItem className="space-y-1">
                        <Select onValueChange={field.onChange} value={field.value} disabled={isSaved}>
                          <FormControl>
                            <SelectTrigger className="h-10 border-border bg-card">
                              <SelectValue placeholder="Category" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {Object.values(IngredientCategory).map((cat) => (
                              <SelectItem key={cat} value={cat}>
                                {cat.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 text-muted-foreground hover:text-destructive"
                  onClick={() => removeIngredient(ingIndex)}
                  disabled={isSaved || ingredientFields.length === 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            className="mt-4 gap-2 text-primary border-primary/20 hover:bg-primary/5 hover:text-primary border-dashed"
            onClick={() => appendIngredient({ name: '', quantity: null, unit: '', category: 'produce' })}
            disabled={isSaved}
          >
            <Plus className="h-4 w-4" /> Add Ingredient
          </Button>
        </div>

        <Separator className="bg-border" />

        <FormField
          control={control}
          name={`drafts.${index}.instructions`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-lg font-serif text-foreground">Instructions</FormLabel>
              <FormControl>
                <Textarea className="min-h-[180px] bg-background border-border text-base leading-relaxed p-4" disabled={isSaved} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end">
          <Button type="button" onClick={onSave} disabled={isSaved || isSaving} className="gap-2">
            {isSaved ? (
              <>
                <Check className="h-4 w-4" /> Saved
              </>
            ) : isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Saving...
              </>
            ) : (
              saveLabel
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
