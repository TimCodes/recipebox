import React, { useState } from 'react';
import { useLocation, Link } from 'wouter';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useGenerateRecipe, useCreateRecipe } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Form } from '@/components/ui/form';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Loader2, Wand2, AlertCircle, Lightbulb } from 'lucide-react';
import { draftSchema, DraftCard, type DraftValues } from '@/components/recipe-draft-form';

// NOTE: the shared DraftCard component hardcodes field paths as `drafts.${index}...`
// (it was extracted from the multi-recipe import flow), so even a single-recipe
// draft here must live under a "drafts" array field, not a singular "draft" object.
const reviewSchema = z.object({ drafts: z.array(draftSchema) });
type ReviewValues = z.infer<typeof reviewSchema>;

function extractErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'data' in err) {
    const data = (err as { data?: unknown }).data as { error?: string } | null;
    if (data?.error) return data.error;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong while generating the recipe.";
}

export default function RecipeGenerate() {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState('');
  const [genError, setGenError] = useState<string | null>(null);
  const [inspiredBy, setInspiredBy] = useState<{ id: number; title: string }[]>([]);
  const [hasResult, setHasResult] = useState(false);
  const [saved, setSaved] = useState(false);

  const generateRecipe = useGenerateRecipe();
  const createRecipe = useCreateRecipe();

  const form = useForm<ReviewValues>({
    resolver: zodResolver(reviewSchema),
    defaultValues: { drafts: [] },
  });

  const handleGenerate = async () => {
    setGenError(null);
    if (!prompt.trim()) {
      setGenError("Describe the recipe you'd like — a dish, cuisine, or ingredients to use up.");
      return;
    }

    try {
      const result = await generateRecipe.mutateAsync({ data: { prompt } });
      const r = result.recipe;
      const draft: DraftValues = {
        title: r.title,
        description: r.description ?? '',
        servings: r.servings ?? undefined,
        prepMinutes: r.prepMinutes ?? undefined,
        cookMinutes: r.cookMinutes ?? undefined,
        tags: (r.tags ?? []).join(', '),
        ingredients: r.ingredients.length > 0
          ? r.ingredients.map((i) => ({ name: i.name, quantity: i.quantity ?? null, unit: i.unit ?? '', category: i.category }))
          : [{ name: '', quantity: 1, unit: '', category: 'produce' as const }],
        instructions: r.instructions,
        saved: false,
      };
      form.reset({ drafts: [draft] });
      setInspiredBy(result.inspiredBy.map((s) => ({ id: s.id, title: s.title })));
      setHasResult(true);
      setSaved(false);
    } catch (err) {
      setGenError(extractErrorMessage(err));
    }
  };

  const handleSave = () => {
    form.trigger('drafts.0').then((valid) => {
      if (!valid) return;
      const draft = draftSchema.parse(form.getValues('drafts.0'));
      const parsedTags = draft.tags ? draft.tags.split(',').map((t) => t.trim()).filter(Boolean) : [];

      createRecipe.mutate(
        {
          data: {
            title: draft.title,
            description: draft.description || undefined,
            servings: draft.servings || undefined,
            prepMinutes: draft.prepMinutes || undefined,
            cookMinutes: draft.cookMinutes || undefined,
            tags: parsedTags,
            ingredients: draft.ingredients.map((i) => ({ ...i, quantity: i.quantity || null, unit: i.unit || null })),
            instructions: draft.instructions,
          },
        },
        {
          onSuccess: () => {
            toast({ title: "Recipe saved!", description: `"${draft.title}" was added to your recipe box.` });
            setSaved(true);
          },
          onError: () => {
            toast({ title: "Error", description: `Failed to save "${draft.title}". Please try again.`, variant: "destructive" });
          },
        },
      );
    });
  };

  const isGenerating = generateRecipe.isPending;

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto w-full animate-in fade-in slide-in-from-bottom-4 duration-500 pb-24">
      <Link href="/recipes" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground mb-6 transition-colors group">
        <ArrowLeft className="h-4 w-4 mr-1 group-hover:-translate-x-1 transition-transform" />
        Back to Recipes
      </Link>

      <div className="mb-8">
        <h1 className="text-4xl font-serif text-foreground tracking-tight flex items-center gap-3">
          <Wand2 className="h-8 w-8 text-primary" />
          Generate Recipe with AI
        </h1>
        <p className="text-muted-foreground text-lg mt-2">
          Describe what you're craving — the AI will draw on your own recipe box for inspiration and invent something new to review.
        </p>
      </div>

      {!hasResult && (
        <Card className="bg-card border-border">
          <CardContent className="p-6 space-y-6">
            <Textarea
              placeholder="e.g. A cozy fall soup using butternut squash, or a quick high-protein breakfast..."
              className="min-h-[140px] bg-background border-border text-base leading-relaxed p-4"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />

            {genError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Couldn't generate a recipe</AlertTitle>
                <AlertDescription>{genError}</AlertDescription>
              </Alert>
            )}

            <Button size="lg" className="w-full gap-2" onClick={handleGenerate} disabled={isGenerating}>
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Generating recipe...
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4" /> Generate Recipe
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {hasResult && (
        <div className="space-y-6">
          {inspiredBy.length > 0 && (
            <Alert>
              <Lightbulb className="h-4 w-4" />
              <AlertTitle>Inspired by your recipes</AlertTitle>
              <AlertDescription>
                <div className="flex flex-wrap gap-2 mt-1">
                  {inspiredBy.map((r) => (
                    <Badge key={r.id} variant="secondary">{r.title}</Badge>
                  ))}
                </div>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex items-center justify-between">
            <p className="text-muted-foreground">Review and edit before saving to your recipe box.</p>
            <Button
              variant="outline"
              onClick={() => { setHasResult(false); setSaved(false); setPrompt(''); form.reset({ drafts: [] }); }}
            >
              Start Over
            </Button>
          </div>

          <Form {...form}>
            <DraftCard
              index={0}
              control={form.control}
              isSaved={saved}
              isSaving={createRecipe.isPending}
              onSave={handleSave}
            />
          </Form>

          {saved && (
            <div className="text-center py-6 text-muted-foreground">
              Saved! <Link href="/recipes" className="text-primary underline">Go to Recipe Box</Link>.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
