import React, { useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { format } from 'date-fns';
import {
  useGenerateMealPlan,
  useCreateRecipe,
  useCreateMealPlanEntry,
  MealSlot,
  type GeneratedMealPlanAssignment,
} from '@workspace/api-client-react';
import { getWeekStart, formatWeekRange } from '@/lib/date-utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Loader2, Wand2, AlertCircle, ChefHat, Sparkles, X } from 'lucide-react';

const ALL_SLOTS = [MealSlot.breakfast, MealSlot.lunch, MealSlot.dinner, MealSlot.snack];

function extractErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'data' in err) {
    const data = (err as { data?: unknown }).data as { error?: string } | null;
    if (data?.error) return data.error;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong while generating the meal plan.";
}

export default function MealPlanGenerate() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();

  const weekStart = new URLSearchParams(search).get('weekStart') || getWeekStart();

  const [prompt, setPrompt] = useState('');
  const [selectedSlots, setSelectedSlots] = useState<MealSlot[]>([MealSlot.dinner]);
  const [genError, setGenError] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<GeneratedMealPlanAssignment[]>([]);
  const [skippedSlots, setSkippedSlots] = useState<{ date: string; mealSlot: MealSlot; reason: string }[]>([]);
  const [planNotes, setPlanNotes] = useState<string | null>(null);
  const [hasResult, setHasResult] = useState(false);
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());
  const [isAccepting, setIsAccepting] = useState(false);

  const generateMealPlan = useGenerateMealPlan();
  const createRecipe = useCreateRecipe();
  const createEntry = useCreateMealPlanEntry();

  const toggleSlot = (slot: MealSlot) => {
    setSelectedSlots((prev) => (prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot]));
  };

  const handleGenerate = async () => {
    setGenError(null);
    if (!prompt.trim()) {
      setGenError("Describe what kind of week you're planning — cuisines, dietary needs, or a theme.");
      return;
    }
    if (selectedSlots.length === 0) {
      setGenError("Choose at least one meal to plan for.");
      return;
    }

    try {
      const result = await generateMealPlan.mutateAsync({
        data: { weekStart, prompt, mealSlots: selectedSlots },
      });
      setAssignments(result.assignments);
      setSkippedSlots(result.skippedSlots);
      setPlanNotes(result.notes);
      setRemovedKeys(new Set());
      setHasResult(true);
    } catch (err) {
      setGenError(extractErrorMessage(err));
    }
  };

  const assignmentKey = (a: { date: string; mealSlot: MealSlot }) => `${a.date.slice(0, 10)}|${a.mealSlot}`;

  const visibleAssignments = assignments.filter((a) => !removedKeys.has(assignmentKey(a)));

  const handleAccept = async () => {
    if (visibleAssignments.length === 0) return;
    setIsAccepting(true);
    try {
      const newRecipeIdByKey = new Map<string, number>();

      for (const a of visibleAssignments) {
        let recipeId: number;

        if (a.existingRecipe) {
          recipeId = a.existingRecipe.id;
        } else if (a.newRecipe) {
          const dedupeKey = a.newRecipeKey ?? `__single__${assignmentKey(a)}`;
          const cached = newRecipeIdByKey.get(dedupeKey);
          if (cached !== undefined) {
            recipeId = cached;
          } else {
            const created = await createRecipe.mutateAsync({
              data: {
                title: a.newRecipe.title,
                description: a.newRecipe.description ?? undefined,
                servings: a.newRecipe.servings ?? undefined,
                prepMinutes: a.newRecipe.prepMinutes ?? undefined,
                cookMinutes: a.newRecipe.cookMinutes ?? undefined,
                tags: a.newRecipe.tags ?? [],
                ingredients: a.newRecipe.ingredients,
                instructions: a.newRecipe.instructions,
              },
            });
            recipeId = created.id;
            newRecipeIdByKey.set(dedupeKey, recipeId);
          }
        } else {
          continue;
        }

        await createEntry.mutateAsync({
          data: { date: a.date.slice(0, 10), mealSlot: a.mealSlot, recipeId },
        });
      }

      toast({ title: "Meal plan added!", description: `${visibleAssignments.length} meal${visibleAssignments.length === 1 ? '' : 's'} added to your plan.` });
      setLocation(`/meal-plan?weekStart=${weekStart}`);
    } catch (err) {
      toast({ title: "Error", description: "Something went wrong while saving the plan. Some meals may have been added already.", variant: "destructive" });
    } finally {
      setIsAccepting(false);
    }
  };

  const isGenerating = generateMealPlan.isPending;

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto w-full animate-in fade-in slide-in-from-bottom-4 duration-500 pb-24">
      <Link href="/meal-plan" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground mb-6 transition-colors group">
        <ArrowLeft className="h-4 w-4 mr-1 group-hover:-translate-x-1 transition-transform" />
        Back to Meal Plan
      </Link>

      <div className="mb-8">
        <h1 className="text-4xl font-serif text-foreground tracking-tight flex items-center gap-3">
          <Wand2 className="h-8 w-8 text-primary" />
          Generate Meal Plan with AI
        </h1>
        <p className="text-muted-foreground text-lg mt-2">
          For the week of <span className="font-medium text-foreground">{formatWeekRange(weekStart)}</span> — the AI will reuse recipes from
          your recipe box where they fit, and propose new ones to fill any gaps. Slots you've already planned are left untouched.
        </p>
      </div>

      {!hasResult && (
        <Card className="bg-card border-border">
          <CardContent className="p-6 space-y-6">
            <div>
              <p className="text-sm font-medium text-foreground mb-3">Which meals should it plan?</p>
              <div className="flex flex-wrap gap-4">
                {ALL_SLOTS.map((slot) => (
                  <label key={slot} className="flex items-center gap-2 cursor-pointer select-none">
                    <Checkbox checked={selectedSlots.includes(slot)} onCheckedChange={() => toggleSlot(slot)} />
                    <span className="capitalize text-foreground">{slot}</span>
                  </label>
                ))}
              </div>
            </div>

            <Textarea
              placeholder="e.g. Mostly vegetarian this week, one big-batch dinner I can eat twice, and something quick on Friday..."
              className="min-h-[140px] bg-background border-border text-base leading-relaxed p-4"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />

            {genError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Couldn't generate a plan</AlertTitle>
                <AlertDescription>{genError}</AlertDescription>
              </Alert>
            )}

            <Button size="lg" className="w-full gap-2" onClick={handleGenerate} disabled={isGenerating}>
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Generating meal plan...
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4" /> Generate Meal Plan
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {hasResult && (
        <div className="space-y-6">
          {planNotes && (
            <Alert>
              <Sparkles className="h-4 w-4" />
              <AlertTitle>Plan notes</AlertTitle>
              <AlertDescription>{planNotes}</AlertDescription>
            </Alert>
          )}

          {skippedSlots.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Some slots were skipped</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {skippedSlots.map((s, i) => (
                    <li key={i}>
                      {format(new Date(`${s.date.slice(0, 10)}T00:00:00`), 'EEE, MMM d')} ({s.mealSlot}): {s.reason}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {visibleAssignments.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No meals left to add. <Link href="/meal-plan" className="text-primary underline">Go back to your meal plan</Link>.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground">
                  Proposed {visibleAssignments.length} meal{visibleAssignments.length === 1 ? '' : 's'}. Remove any you don't want, then accept.
                </p>
                <Button
                  variant="outline"
                  onClick={() => { setHasResult(false); setAssignments([]); setSkippedSlots([]); setPlanNotes(null); }}
                >
                  Start Over
                </Button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {assignments.map((a) => {
                  const key = assignmentKey(a);
                  if (removedKeys.has(key)) return null;
                  const title = a.existingRecipe?.title ?? a.newRecipe?.title ?? 'Untitled';
                  const isNew = !a.existingRecipe;

                  return (
                    <Card key={key} className="border-border bg-card relative">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-2 right-2 h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => setRemovedKeys((prev) => new Set(prev).add(key))}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      <CardContent className="p-5 space-y-2">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          <span>{format(new Date(`${a.date.slice(0, 10)}T00:00:00`), 'EEEE, MMM d')}</span>
                          <span>·</span>
                          <span className="capitalize">{a.mealSlot}</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <ChefHat className="h-4 w-4 text-primary mt-1 shrink-0" />
                          <h4 className="font-medium text-foreground leading-snug">{title}</h4>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {isNew && <Badge variant="secondary">New recipe</Badge>}
                          {a.newRecipeKey && <Badge variant="outline">Reused across slots</Badge>}
                        </div>
                        {a.note && <p className="text-sm text-muted-foreground italic">{a.note}</p>}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              <Button size="lg" className="w-full gap-2" onClick={handleAccept} disabled={isAccepting}>
                {isAccepting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Adding to your plan...
                  </>
                ) : (
                  <>
                    <Wand2 className="h-4 w-4" /> Accept Plan
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
