import React, { useRef, useState } from 'react';
import { useLocation, Link } from 'wouter';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useIngestRecipes, useCreateRecipe } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Form } from '@/components/ui/form';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Loader2, UploadCloud, FileText, Sparkles, AlertCircle, X } from 'lucide-react';
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

  const ingestRecipes = useIngestRecipes();
  const createRecipe = useCreateRecipe();

  const form = useForm<ReviewValues>({
    resolver: zodResolver(reviewSchema),
    defaultValues: { drafts: [] },
  });

  const { fields, remove, update } = useFieldArray({
    control: form.control,
    name: "drafts",
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setSelectedFile(file ?? null);
  };

  const handleExtract = async () => {
    setIngestError(null);
    setWarnings([]);

    try {
      let result;
      if (selectedFile) {
        const fileBase64 = await readFileAsBase64(selectedFile);
        result = await ingestRecipes.mutateAsync({
          data: { source: 'pdf', fileBase64, fileName: selectedFile.name },
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
          saved: false,
        })),
      });
      setWarnings(result.warnings ?? []);
      setHasResults(true);
    } catch (err) {
      setIngestError(extractErrorMessage(err));
    }
  };

  const saveDraft = (index: number) => {
    form.trigger(`drafts.${index}`).then((valid) => {
      if (!valid) return;
      // Re-parse through the Zod schema so numeric fields (which arrive as raw
      // strings from <input type="number">) are coerced to actual numbers —
      // form.getValues() alone returns the raw, un-coerced field values.
      const draft = draftSchema.parse(form.getValues(`drafts.${index}`));
      const parsedTags = draft.tags
        ? draft.tags.split(',').map((t) => t.trim()).filter(Boolean)
        : [];

      createRecipe.mutate(
        {
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
          },
        },
        {
          onSuccess: () => {
            toast({ title: "Recipe saved!", description: `"${draft.title}" was added to your recipe box.` });
            update(index, { ...draft, saved: true });
          },
          onError: () => {
            toast({
              title: "Error",
              description: `Failed to save "${draft.title}". Please try again.`,
              variant: "destructive",
            });
          },
        },
      );
    });
  };

  const isExtracting = ingestRecipes.isPending;

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
                      <p className="text-sm text-muted-foreground">One or more recipes in a single PDF are supported.</p>
                    </>
                  )}
                </div>
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
                  <Sparkles className="h-4 w-4" /> Extract Recipe
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

          <div className="flex items-center justify-between">
            <p className="text-muted-foreground">
              Found {fields.length} recipe{fields.length === 1 ? '' : 's'}. Review and edit before saving each one.
            </p>
            <Button variant="outline" onClick={() => { setHasResults(false); setSelectedFile(null); setPastedText(''); form.reset({ drafts: [] }); }}>
              Start Over
            </Button>
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
