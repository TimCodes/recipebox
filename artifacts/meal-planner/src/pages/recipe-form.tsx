import React, { useEffect, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  useCreateRecipe,
  useUpdateRecipe,
  useGetRecipe,
  getGetRecipeQueryKey,
  getListRecipesQueryKey,
} from '@workspace/api-client-react';
import { IngredientCategory } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Plus, Trash2, Loader2, Image as ImageIcon } from 'lucide-react';
import { Link } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';

const ingredientSchema = z.object({
  name: z.string().min(1, "Ingredient name is required"),
  quantity: z.coerce.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  category: z.nativeEnum(IngredientCategory),
});

const recipeSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  servings: z.coerce.number().min(1, "Must be at least 1").nullable().optional(),
  prepMinutes: z.coerce.number().min(0, "Must be positive").nullable().optional(),
  cookMinutes: z.coerce.number().min(0, "Must be positive").nullable().optional(),
  photoUrl: z.string()
    .refine(v => v === '' || v.startsWith('/') || /^https?:\/\//.test(v), {
      message: "Must be a valid URL or an image path starting with /",
    })
    .optional()
    .or(z.literal('')),
  tags: z.string(), // We'll parse this to an array on submit
  ingredients: z.array(ingredientSchema).min(1, "At least one ingredient is required"),
  instructions: z.string().min(1, "Instructions are required"),
});

export default function RecipeForm() {
  const { id } = useParams();
  const recipeId = id ? parseInt(id, 10) : undefined;
  const isEditMode = recipeId !== undefined && !isNaN(recipeId);

  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createRecipe = useCreateRecipe();
  const updateRecipe = useUpdateRecipe();

  const { data: existingRecipe, isLoading: isLoadingRecipe } = useGetRecipe(recipeId ?? 0, {
    query: { queryKey: getGetRecipeQueryKey(recipeId ?? 0), enabled: isEditMode },
  });

  const form = useForm<z.infer<typeof recipeSchema>>({
    resolver: zodResolver(recipeSchema),
    defaultValues: {
      title: '',
      description: '',
      servings: 2,
      prepMinutes: 15,
      cookMinutes: 30,
      photoUrl: '',
      tags: '',
      ingredients: [{ name: '', quantity: 1, unit: '', category: 'produce' }],
      instructions: '',
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "ingredients",
  });

  useEffect(() => {
    if (isEditMode && existingRecipe) {
      form.reset({
        title: existingRecipe.title,
        description: existingRecipe.description || '',
        servings: existingRecipe.servings ?? undefined,
        prepMinutes: existingRecipe.prepMinutes ?? undefined,
        cookMinutes: existingRecipe.cookMinutes ?? undefined,
        photoUrl: existingRecipe.photoUrl || '',
        tags: (existingRecipe.tags || []).join(', '),
        ingredients: existingRecipe.ingredients.length > 0
          ? existingRecipe.ingredients.map(i => ({
              name: i.name,
              quantity: i.quantity ?? null,
              unit: i.unit ?? '',
              category: i.category,
            }))
          : [{ name: '', quantity: 1, unit: '', category: 'produce' as const }],
        instructions: existingRecipe.instructions,
      });
    }
  }, [isEditMode, existingRecipe, form]);

  const onSubmit = (values: z.infer<typeof recipeSchema>) => {
    // Parse tags from comma separated string
    const parsedTags = values.tags
      ? values.tags.split(',').map(t => t.trim()).filter(Boolean)
      : [];

    const payload = {
      title: values.title,
      description: values.description || undefined,
      servings: values.servings || undefined,
      prepMinutes: values.prepMinutes || undefined,
      cookMinutes: values.cookMinutes || undefined,
      photoUrl: values.photoUrl || undefined,
      tags: parsedTags,
      ingredients: values.ingredients.map(i => ({
        ...i,
        quantity: i.quantity || null,
        unit: i.unit || null
      })),
      instructions: values.instructions,
    };

    if (isEditMode && recipeId !== undefined) {
      updateRecipe.mutate({ id: recipeId, data: payload }, {
        onSuccess: (data) => {
          toast({
            title: "Recipe updated!",
            description: "Your changes have been saved.",
          });
          queryClient.invalidateQueries({ queryKey: getGetRecipeQueryKey(recipeId) });
          queryClient.invalidateQueries({ queryKey: getListRecipesQueryKey() });
          setLocation(`/recipes/${data.id}`);
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Failed to update the recipe. Please try again.",
            variant: "destructive",
          });
        }
      });
      return;
    }

    createRecipe.mutate({
      data: payload
    }, {
      onSuccess: (data) => {
        toast({
          title: "Recipe saved!",
          description: "Your recipe has been added to your box.",
        });
        setLocation(`/recipes/${data.id}`);
      },
      onError: () => {
        toast({
          title: "Error",
          description: "Failed to save the recipe. Please try again.",
          variant: "destructive",
        });
      }
    });
  };

  const photoUrl = form.watch('photoUrl');
  const isSaving = createRecipe.isPending || updateRecipe.isPending;

  if (isEditMode && isLoadingRecipe) {
    return (
      <div className="p-6 md:p-10 max-w-4xl mx-auto w-full space-y-8">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto w-full animate-in fade-in slide-in-from-bottom-4 duration-500 pb-24">
      <Link href={isEditMode ? `/recipes/${recipeId}` : "/recipes"} className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground mb-6 transition-colors group">
        <ArrowLeft className="h-4 w-4 mr-1 group-hover:-translate-x-1 transition-transform" />
        {isEditMode ? 'Back to Recipe' : 'Back to Recipes'}
      </Link>

      <div className="mb-8">
        <h1 className="text-4xl font-serif text-foreground tracking-tight">{isEditMode ? 'Edit Recipe' : 'Add New Recipe'}</h1>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-10">
          
          {/* Header Info */}
          <section className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-8">
            <div className="space-y-6">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Recipe Title</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Nonna's Sunday Sauce" className="text-lg h-14 bg-card border-border" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (Optional)</FormLabel>
                    <FormControl>
                      <Textarea placeholder="A brief note about why this recipe is special..." className="resize-none bg-card border-border h-24" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="prepMinutes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prep (min)</FormLabel>
                      <FormControl>
                        <Input type="number" min="0" className="bg-card border-border" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="cookMinutes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cook (min)</FormLabel>
                      <FormControl>
                        <Input type="number" min="0" className="bg-card border-border" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="servings"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Servings</FormLabel>
                      <FormControl>
                        <Input type="number" min="1" className="bg-card border-border" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="tags"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tags</FormLabel>
                    <FormControl>
                      <Input placeholder="pasta, dinner, quick (comma separated)" className="bg-card border-border" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            
            {/* Photo preview */}
            <div className="space-y-4">
              <label className="text-sm font-medium leading-none">Recipe Photo</label>
              <div className="aspect-[4/3] rounded-xl border border-border overflow-hidden bg-muted flex items-center justify-center relative">
                {photoUrl ? (
                  <img src={photoUrl} alt="Preview" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.src = ''; }} />
                ) : (
                  <div className="text-muted-foreground flex flex-col items-center gap-2">
                    <ImageIcon className="h-10 w-10 opacity-50" />
                    <span className="text-sm opacity-70">No image</span>
                  </div>
                )}
              </div>
              <FormField
                control={form.control}
                name="photoUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input placeholder="Image URL (https://...)" className="bg-card border-border text-sm" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </section>

          <Separator className="bg-border" />

          {/* Ingredients */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-serif text-foreground">Ingredients</h2>
            </div>
            
            <div className="space-y-3">
              {fields.map((field, index) => (
                <div key={field.id} className="flex items-start gap-3 p-3 bg-card rounded-lg border border-border animate-in slide-in-from-left-2 fade-in">
                  <div className="grid grid-cols-[1fr_80px_100px_140px] gap-3 flex-1 items-start">
                    <FormField
                      control={form.control}
                      name={`ingredients.${index}.name`}
                      render={({ field }) => (
                        <FormItem className="space-y-1">
                          {index === 0 && <FormLabel className="text-xs text-muted-foreground">Ingredient</FormLabel>}
                          <FormControl>
                            <Input placeholder="e.g. Garlic" className="h-10 border-border bg-background" {...field} />
                          </FormControl>
                          <FormMessage className="text-xs" />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`ingredients.${index}.quantity`}
                      render={({ field }) => (
                        <FormItem className="space-y-1">
                          {index === 0 && <FormLabel className="text-xs text-muted-foreground">Qty</FormLabel>}
                          <FormControl>
                            <Input type="number" step="any" placeholder="1" className="h-10 border-border bg-background" {...field} value={field.value || ''} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`ingredients.${index}.unit`}
                      render={({ field }) => (
                        <FormItem className="space-y-1">
                          {index === 0 && <FormLabel className="text-xs text-muted-foreground">Unit</FormLabel>}
                          <FormControl>
                            <Input placeholder="clove" className="h-10 border-border bg-background" {...field} value={field.value || ''} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`ingredients.${index}.category`}
                      render={({ field }) => (
                        <FormItem className="space-y-1">
                          {index === 0 && <FormLabel className="text-xs text-muted-foreground">Category</FormLabel>}
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger className="h-10 border-border bg-background">
                                <SelectValue placeholder="Category" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {Object.values(IngredientCategory).map(cat => (
                                <SelectItem key={cat} value={cat}>
                                  {cat.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className={index === 0 ? "pt-6" : "pt-0"}>
                    <Button 
                      type="button" 
                      variant="ghost" 
                      size="icon" 
                      className="h-10 w-10 text-muted-foreground hover:text-destructive"
                      onClick={() => remove(index)}
                      disabled={fields.length === 1}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            
            <Button 
              type="button" 
              variant="outline" 
              className="mt-4 gap-2 text-primary border-primary/20 hover:bg-primary/5 hover:text-primary border-dashed"
              onClick={() => append({ name: '', quantity: null, unit: '', category: 'produce' })}
            >
              <Plus className="h-4 w-4" /> Add Ingredient
            </Button>
          </section>

          <Separator className="bg-border" />

          {/* Instructions */}
          <section>
            <div className="mb-4">
              <h2 className="text-2xl font-serif text-foreground mb-1">Instructions</h2>
              <p className="text-sm text-muted-foreground">Write your steps clearly. One step per line works best.</p>
            </div>
            <FormField
              control={form.control}
              name="instructions"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Textarea 
                      placeholder="1. Preheat the oven to 400°F...&#10;2. Chop the garlic..." 
                      className="min-h-[250px] bg-card border-border text-base leading-relaxed p-4" 
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </section>

          {/* Sticky footer for actions */}
          <div className="fixed bottom-0 left-0 right-0 md:left-[260px] p-4 bg-background/80 backdrop-blur-md border-t border-border flex justify-end gap-4 z-10">
            <Link href={isEditMode ? `/recipes/${recipeId}` : "/recipes"}>
              <Button type="button" variant="ghost">Cancel</Button>
            </Link>
            <Button type="submit" disabled={isSaving} className="shadow-md">
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                isEditMode ? 'Save Changes' : 'Save to Recipe Box'
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
