import React, { useRef, useState } from 'react';
import { useLocation, Link } from 'wouter';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useIngestRecipes, useCreateRecipe, useOutlineRecipePdf } from '@workspace/api-client-react';
import type { PdfRecipeCandidate } from '@workspace/api-client-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Form } from '@/components/ui/form';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Loader2, UploadCloud, FileText, Sparkles, AlertCircle, X, ListChecks, Search, Save } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { draftSchema, DraftCard } from '@/components/recipe-draft-form';

const reviewSchema = z.object({
  drafts: z.array(draftSchema),
});

type ReviewValues = z.infer<typeof reviewSchema>;

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip the "data:application/pdf;base64," prefix
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function extractErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'data' in err) {
    const data = (err as { data?: unknown }).data as { error?: string } | null;
    if (data?.error) return data.error;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong while extracting the recipe.";
}

export default function RecipeImport() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pastedText, setPastedText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [hasResults, setHasResults] = useState(false);

  // Locally detected recipes in the uploaded PDF. Produced with no AI call at all, so the
  // user can browse a whole cookbook for free and only pay for what they pick.
  const [candidates, setCandidates] = useState<PdfRecipeCandidate[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState('');
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);

  // Progress for the bulk save, so a 60-recipe cookbook doesn't just freeze the button.
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const ingestRecipes = useIngestRecipes();
  const outlinePdf = useOutlineRecipePdf();
  const createRecipe = useCreateRecipe();

  const form = useForm<ReviewValues>({
    resolver: zodResolver(reviewSchema),
    defaultValues: { drafts: [] },
  });

  const { fields, remove, update } = useFieldArray({
    control: form.control,
    name: "drafts",
  });

  const resetPdfState = () => {
    setCandidates(null);
    setSelected(new Set());
    setFilter('');
    setPdfBase64(null);
    setIngestError(null);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    resetPdfState();
    if (!file) return;

    // Scan immediately. This is text extraction plus local heuristics — no tokens, no cost —
    // so there is nothing to lose by doing it the moment a file is chosen.
    try {
      const fileBase64 = await readFileAsBase64(file);
      setPdfBase64(fileBase64);
      const result = await outlinePdf.mutateAsync({ data: { fileBase64, fileName: file.name } });
      setCandidates(result.candidates);
      setSelected(new Set(result.candidates.map((_, i) => i)));
    } catch (err) {
      // A failed scan is not fatal: fall back to extracting the whole document.
      setCandidates([]);
      setIngestError(extractErrorMessage(err));
    }
  };

  /** Page numbers covered by the ticked recipes, as whole ranges so multi-page recipes are not cut. */
  const selectedPages = (): number[] => {
    if (!candidates) return [];
    const pages = new Set<number>();
    for (const i of selected) {
      const c = candidates[i];
      if (!c) continue;
      for (let p = c.startPage; p <= c.endPage; p++) pages.add(p);
    }
    return [...pages].sort((a, b) => a - b);
  };

  const handleExtract = async () => {
    setIngestError(null);
    setWarnings([]);

    try {
      let result;
      if (selectedFile) {
        const fileBase64 = pdfBase64 ?? (await readFileAsBase64(selectedFile));
        const pages = selectedPages();
        result = await ingestRecipes.mutateAsync({
          data: {
            source: 'pdf',
            fileBase64,
            fileName: selectedFile.name,
            // Omitted when nothing was detected, which makes the server scan the whole file.
            ...(pages.length > 0 ? { pages } : {}),
          },
        });
      } else if (pastedText.trim()) {
        result = await ingestRecipes.mutateAsync({
          data: { source: 'text', text: pastedText },
        });
      } else {
        setIngestError("Paste some recipe text or choose a PDF file first.");
        return;
      }

      form.reset({
        drafts: result.recipes.map((r) => ({
          title: r.title,
          description: r.description ?? '',
          servings: r.servings ?? undefined,
          prepMinutes: r.prepMinutes ?? undefined,
          cookMinutes: r.cookMinutes ?? undefined,
          tags: (r.tags ?? []).join(', '),
          ingredients: r.ingredients.length > 0
            ? r.ingredients.map((i) => ({
                name: i.name,
                quantity: i.quantity ?? null,
                unit: i.unit ?? '',
                category: i.category,
              }))
            : [{ name: '', quantity: 1, unit: '', category: 'produce' as const }],
          instructions: r.instructions,
          nutrition: r.nutrition ?? undefined,
          saved: false,
        })),
      });
      setWarnings(result.warnings ?? []);
      setHasResults(true);
    } catch (err) {
      setIngestError(extractErrorMessage(err));
    }
  };

  /** Shared by the per-card save and by Save All, so both build the payload identically. */
  const saveOne = async (index: number): Promise<'saved' | 'invalid' | 'error'> => {
    const valid = await form.trigger(`drafts.${index}`);
    if (!valid) return 'invalid';

    // Re-parse through the Zod schema so numeric fields (which arrive as raw
    // strings from <input type="number">) are coerced to actual numbers —
    // form.getValues() alone returns the raw, un-coerced field values.
    const draft = draftSchema.parse(form.getValues(`drafts.${index}`));
    if (draft.saved) return 'saved';

    const parsedTags = draft.tags
      ? draft.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : [];

    try {
      await createRecipe.mutateAsync({
        data: {
          title: draft.title,
          description: draft.description || undefined,
          servings: draft.servings || undefined,
          prepMinutes: draft.prepMinutes || undefined,
          cookMinutes: draft.cookMinutes || undefined,
          tags: parsedTags,
          ingredients: draft.ingredients.map((i) => ({
            ...i,
            quantity: i.quantity || null,
            unit: i.unit || null,
          })),
          instructions: draft.instructions,
          ...(draft.nutrition ? { nutrition: draft.nutrition } : {}),
        },
      });
      update(index, { ...draft, saved: true });
      return 'saved';
    } catch {
      return 'error';
    }
  };

  const saveDraft = (index: number) => {
    const title = form.getValues(`drafts.${index}.title`);
    void saveOne(index).then((result) => {
      if (result === 'saved') {
        toast({ title: "Recipe saved!", description: `"${title}" was added to your recipe box.` });
      } else if (result === 'error') {
        toast({
          title: "Error",
          description: `Failed to save "${title}". Please try again.`,
          variant: "destructive",
        });
      }
      // 'invalid' needs no toast — react-hook-form has already marked the offending fields.
    });
  };

  /**
   * Saves every draft that hasn't been saved yet. Sequential rather than parallel: a large
   * cookbook can produce dozens of drafts, and firing them all at once would make a partial
   * failure much harder to report accurately.
   */
  const saveAll = async () => {
    const drafts = form.getValues('drafts');
    const pending = drafts
      .map((draft, index) => ({ draft, index }))
      .filter(({ draft }) => !draft.saved);

    if (pending.length === 0) return;

    setBulkProgress({ done: 0, total: pending.length });
    let saved = 0;
    let invalid = 0;
    let failed = 0;

    for (const { index } of pending) {
      const result = await saveOne(index);
      if (result === 'saved') saved += 1;
      else if (result === 'invalid') invalid += 1;
      else failed += 1;
      setBulkProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    }

    setBulkProgress(null);

    const problems = invalid + failed;
    if (problems === 0) {
      toast({
        title: `Saved ${saved} recipe${saved === 1 ? '' : 's'}`,
        description: "They're all in your recipe box now.",
      });
    } else {
      // Report exactly what happened rather than a generic failure: the cards that need
      // attention stay on screen with their validation errors showing.
      const parts = [
        `${saved} saved`,
        invalid > 0 ? `${invalid} need${invalid === 1 ? 's' : ''} fixing` : null,
        failed > 0 ? `${failed} failed` : null,
      ].filter(Boolean);
      toast({
        title: "Some recipes weren't saved",
        description: `${parts.join(', ')}. The remaining cards are still below.`,
        variant: "destructive",
      });
    }
  };
;

  const isExtracting = ingestRecipes.isPending;
  const isBulkSaving = bulkProgress !== null;
  // Watch the array so the count updates as cards are saved one by one.
  const unsavedCount = (form.watch('drafts') ?? []).filter((d) => !d.saved).length;

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto w-full animate-in fade-in slide-in-from-bottom-4 duration-500 pb-24">
      <Link href="/recipes" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground mb-6 transition-colors group">
        <ArrowLeft className="h-4 w-4 mr-1 group-hover:-translate-x-1 transition-transform" />
        Back to Recipes
      </Link>

      <div className="mb-8">
        <h1 className="text-4xl font-serif text-foreground tracking-tight flex items-center gap-3">
          <Sparkles className="h-8 w-8 text-primary" />
          Import Recipe
        </h1>
        <p className="text-muted-foreground text-lg mt-2">
          Paste recipe text or upload a PDF — we'll pull out the title, ingredients, and steps for you to review.
        </p>
      </div>

      {!hasResults && (
        <Card className="bg-card border-border">
          <CardContent className="p-6 space-y-6">
            <Tabs defaultValue="text" onValueChange={() => { setSelectedFile(null); setPastedText(''); setIngestError(null); }}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="text">Paste Text</TabsTrigger>
                <TabsTrigger value="pdf">Upload PDF</TabsTrigger>
              </TabsList>
              <TabsContent value="text" className="mt-4">
                <Textarea
                  placeholder="Paste the full recipe (or several recipes) here..."
                  className="min-h-[280px] bg-background border-border text-base leading-relaxed p-4"
                  value={pastedText}
                  onChange={(e) => { setPastedText(e.target.value); setSelectedFile(null); }}
                />
              </TabsContent>
              <TabsContent value="pdf" className="mt-4">
                <div
                  className="border-2 border-dashed border-border rounded-xl p-10 text-center flex flex-col items-center gap-3 cursor-pointer hover:border-primary/40 hover:bg-muted/30 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  {selectedFile ? (
                    <>
                      <FileText className="h-10 w-10 text-primary" />
                      <p className="font-medium text-foreground">{selectedFile.name}</p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground"
                        onClick={(e) => { e.stopPropagation(); setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                      >
                        <X className="h-4 w-4 mr-1" /> Remove
                      </Button>
                    </>
                  ) : (
                    <>
                      <UploadCloud className="h-10 w-10 text-muted-foreground" />
                      <p className="font-medium text-foreground">Click to choose a PDF</p>
                      <p className="text-sm text-muted-foreground">Cookbooks are fine — you'll get to pick which recipes to import.</p>
                    </>
                  )}
                </div>

                {outlinePdf.isPending && (
                  <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Scanning the PDF for recipes...
                  </div>
                )}

                {candidates && candidates.length > 0 && (
                  <div className="mt-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground flex items-center gap-2">
                        <ListChecks className="h-4 w-4 text-primary" />
                        Found {candidates.length} recipe{candidates.length === 1 ? '' : 's'} — pick the ones to import
                      </p>
                      <div className="flex items-center gap-2">
                        <Button type="button" variant="ghost" size="sm"
                          onClick={() => setSelected(new Set(candidates.map((_, i) => i)))}>Select all</Button>
                        <Button type="button" variant="ghost" size="sm"
                          onClick={() => setSelected(new Set())}>Clear</Button>
                      </div>
                    </div>

                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Filter recipes..."
                        className="pl-9"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      />
                    </div>

                    <div className="max-h-[22rem] overflow-y-auto rounded-lg border border-border divide-y divide-border">
                      {candidates.map((c, i) => {
                        if (filter && !c.title.toLowerCase().includes(filter.toLowerCase())) return null;
                        const checked = selected.has(i);
                        return (
                          <label key={`${c.startPage}-${i}`}
                            className="flex items-start gap-3 p-3 cursor-pointer hover:bg-muted/40 transition-colors">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => {
                                const next = new Set(selected);
                                if (checked) next.delete(i); else next.add(i);
                                setSelected(next);
                              }}
                              className="mt-0.5"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline gap-2">
                                <span className="font-medium text-foreground truncate">{c.title}</span>
                                {/* Always show the range: title detection is heuristic, so the page
                                    numbers let the user sanity-check a bad guess. */}
                                <span className="text-xs text-muted-foreground shrink-0">
                                  {c.startPage === c.endPage ? `p${c.startPage}` : `p${c.startPage}–${c.endPage}`}
                                </span>
                              </div>
                              {c.snippet && (
                                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{c.snippet}</p>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>

                    <p className="text-xs text-muted-foreground">
                      {selected.size === 0
                        ? 'Nothing selected — the whole document will be scanned.'
                        : `${selected.size} selected, covering ${selectedPages().length} of ${candidates.length > 0 ? 'the' : ''} PDF pages. Only these are sent to the AI.`}
                    </p>
                  </div>
                )}

                {candidates && candidates.length === 0 && !outlinePdf.isPending && (
                  <p className="mt-4 text-sm text-muted-foreground">
                    Couldn't pick out individual recipes in this PDF, so the whole document will be scanned.
                  </p>
                )}
              </TabsContent>
            </Tabs>

            {ingestError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Couldn't extract a recipe</AlertTitle>
                <AlertDescription>{ingestError}</AlertDescription>
              </Alert>
            )}

            <Button size="lg" className="w-full gap-2" onClick={handleExtract} disabled={isExtracting}>
              {isExtracting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Extracting recipe...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  {candidates && candidates.length > 0 && selected.size > 0
                    ? `Extract ${selected.size} Recipe${selected.size === 1 ? '' : 's'}`
                    : 'Extract Recipe'}
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {hasResults && (
        <div className="space-y-8">
          {warnings.length > 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Heads up</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-muted-foreground">
              Found {fields.length} recipe{fields.length === 1 ? '' : 's'}.
              {unsavedCount > 0
                ? ' Review and edit, then save them individually or all at once.'
                : ' All saved.'}
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                disabled={isBulkSaving}
                onClick={() => { setHasResults(false); setSelectedFile(null); setPastedText(''); resetPdfState(); form.reset({ drafts: [] }); }}
              >
                Start Over
              </Button>
              {unsavedCount > 0 && (
                <Button className="gap-2" onClick={saveAll} disabled={isBulkSaving}>
                  {isBulkSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving {bulkProgress?.done ?? 0} of {bulkProgress?.total ?? 0}...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      Save All ({unsavedCount})
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>

          <Form {...form}>
            <div className="space-y-10">
              {fields.map((field, index) => (
                <DraftCard
                  key={field.id}
                  index={index}
                  control={form.control}
                  isSaved={form.watch(`drafts.${index}.saved`)}
                  isSaving={createRecipe.isPending}
                  onRemove={() => remove(index)}
                  onSave={() => saveDraft(index)}
                />
              ))}
            </div>
          </Form>

          {fields.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              All recipes have been handled. <Link href="/recipes" className="text-primary underline">Go to Recipe Box</Link>.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
