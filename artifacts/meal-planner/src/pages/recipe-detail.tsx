import React, { useState } from 'react';
import { useLocation, useParams, Link } from 'wouter';
import { 
  useGetRecipe, 
  useDeleteRecipe, 
  useCreateGroceryListItem,
  getGetRecipeQueryKey, 
  getListRecipesQueryKey,
  getListGroceryListItemsQueryKey,
} from '@workspace/api-client-react';
import { getWeekStart } from '@/lib/date-utils';
import { useQueryClient } from '@tanstack/react-query';
import { 
  ArrowLeft, Clock, Users, ChefHat, Edit, Trash2, Tag, CheckCircle2,
  CalendarPlus, MoreVertical
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function RecipeDetail() {
  const { id } = useParams();
  const recipeId = parseInt(id || '0', 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: recipe, isLoading, isError } = useGetRecipe(recipeId, {
    query: { queryKey: getGetRecipeQueryKey(recipeId), enabled: !isNaN(recipeId) }
  });

  const deleteRecipe = useDeleteRecipe();
  const createGroceryItem = useCreateGroceryListItem();
  const [isAddingToGrocery, setIsAddingToGrocery] = useState(false);

  const handleAddToGroceryList = async () => {
    if (!recipe) return;
    setIsAddingToGrocery(true);
    const weekStart = getWeekStart();
    try {
      await Promise.all(
        recipe.ingredients.map(ing =>
          createGroceryItem.mutateAsync({
            data: {
              weekStart,
              name: ing.name,
              quantity: ing.quantity ?? undefined,
              unit: ing.unit ?? undefined,
              category: ing.category,
            },
          })
        )
      );
      toast({
        title: "Added to grocery list",
        description: `${recipe.ingredients.length} ingredient(s) added to this week's list.`,
      });
      queryClient.invalidateQueries({ queryKey: getListGroceryListItemsQueryKey({ weekStart }) });
    } catch {
      toast({
        title: "Error",
        description: "Failed to add ingredients to the grocery list.",
        variant: "destructive",
      });
    } finally {
      setIsAddingToGrocery(false);
    }
  };

  const handleDelete = () => {
    deleteRecipe.mutate({ id: recipeId }, {
      onSuccess: () => {
        toast({ title: "Recipe deleted", description: "The recipe has been removed." });
        queryClient.invalidateQueries({ queryKey: getListRecipesQueryKey() });
        setLocation('/recipes');
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to delete recipe.", variant: "destructive" });
      }
    });
  };

  if (isLoading) {
    return (
      <div className="p-6 md:p-10 max-w-4xl mx-auto w-full space-y-8">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-[400px] w-full rounded-3xl" />
        <div className="space-y-4">
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="h-6 w-1/3" />
        </div>
      </div>
    );
  }

  if (isError || !recipe) {
    return (
      <div className="p-10 text-center flex flex-col items-center justify-center max-w-md mx-auto mt-20">
        <h3 className="text-2xl font-serif text-foreground mb-2">Recipe not found</h3>
        <p className="text-muted-foreground mb-8 text-lg">We couldn't find this recipe. It may have been deleted.</p>
        <Link href="/recipes">
          <Button variant="outline">Back to Recipe Box</Button>
        </Link>
      </div>
    );
  }

  const instructionsList = recipe.instructions.split('\n').filter(s => s.trim().length > 0);

  return (
    <div className="max-w-5xl mx-auto w-full bg-background animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      
      {/* Hero Image Section */}
      <div className="relative h-[40vh] md:h-[50vh] min-h-[300px] w-full bg-muted flex flex-col">
        {recipe.photoUrl ? (
          <img src={recipe.photoUrl} alt={recipe.title} className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-secondary/10 flex flex-col items-center justify-center text-secondary/40">
            <ChefHat className="h-24 w-24 mb-4 opacity-50" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent"></div>
        
        {/* Navigation & Actions */}
        <div className="absolute top-0 left-0 right-0 p-6 flex items-start justify-between z-10">
          <Link href="/recipes">
            <Button variant="secondary" size="icon" className="rounded-full bg-background/80 backdrop-blur-md border-transparent hover:bg-background shadow-sm">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          
          <div className="flex gap-2">
            <Link href={`/meal-plan?recipe=${recipe.id}`}>
              <Button variant="secondary" size="sm" className="hidden sm:flex rounded-full bg-background/80 backdrop-blur-md border-transparent hover:bg-background shadow-sm gap-2">
                <CalendarPlus className="h-4 w-4" /> Add to Plan
              </Button>
            </Link>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon" className="rounded-full bg-background/80 backdrop-blur-md border-transparent hover:bg-background shadow-sm">
                  <MoreVertical className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <Link href={`/recipes/${recipe.id}/edit`}>
                  <DropdownMenuItem>
                    <Edit className="mr-2 h-4 w-4" /> Edit Recipe
                  </DropdownMenuItem>
                </Link>
                <Link href={`/meal-plan?recipe=${recipe.id}`}>
                  <DropdownMenuItem className="sm:hidden">
                    <CalendarPlus className="mr-2 h-4 w-4" /> Add to Meal Plan
                  </DropdownMenuItem>
                </Link>
                <Separator className="my-1" />
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive focus:bg-destructive/10 focus:text-destructive">
                      <Trash2 className="mr-2 h-4 w-4" /> Delete Recipe
                    </DropdownMenuItem>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this recipe?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently remove "{recipe.title}" from your recipe box. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Title overlay */}
        <div className="mt-auto p-6 md:px-10 z-10">
          <div className="flex flex-wrap gap-2 mb-4">
            {recipe.tags?.map(tag => (
              <Badge key={tag} variant="secondary" className="bg-primary text-primary-foreground border-transparent px-3 py-1 font-medium shadow-sm">
                <Tag className="h-3 w-3 mr-1" /> {tag}
              </Badge>
            ))}
          </div>
          <h1 className="text-4xl md:text-6xl font-serif text-foreground tracking-tight leading-tight max-w-3xl">
            {recipe.title}
          </h1>
          {recipe.description && (
            <p className="mt-4 text-lg md:text-xl text-muted-foreground max-w-2xl leading-relaxed">
              {recipe.description}
            </p>
          )}
        </div>
      </div>

      <div className="px-6 md:px-10 mt-6">
        {/* Meta Stats */}
        <div className="flex flex-wrap gap-6 md:gap-12 py-6 border-y border-border bg-card/50 rounded-2xl px-8 shadow-sm">
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">Prep Time</span>
            <span className="text-xl font-serif flex items-center gap-2 text-foreground">
              <Clock className="h-5 w-5 text-primary/70" /> 
              {recipe.prepMinutes ? `${recipe.prepMinutes} mins` : '--'}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">Cook Time</span>
            <span className="text-xl font-serif flex items-center gap-2 text-foreground">
              <Clock className="h-5 w-5 text-primary/70" /> 
              {recipe.cookMinutes ? `${recipe.cookMinutes} mins` : '--'}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">Total Time</span>
            <span className="text-xl font-serif flex items-center gap-2 text-foreground">
              <Clock className="h-5 w-5 text-primary/70" /> 
              {(recipe.prepMinutes || 0) + (recipe.cookMinutes || 0) > 0 ? `${(recipe.prepMinutes || 0) + (recipe.cookMinutes || 0)} mins` : '--'}
            </span>
          </div>
          <div className="flex flex-col border-l border-border pl-6 md:pl-12">
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">Yield</span>
            <span className="text-xl font-serif flex items-center gap-2 text-foreground">
              <Users className="h-5 w-5 text-secondary" /> 
              {recipe.servings ? `${recipe.servings} servings` : '--'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-12 mt-12">
          
          {/* Ingredients Side */}
          <div className="space-y-6">
            <h2 className="text-3xl font-serif text-foreground">Ingredients</h2>
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
              <ul className="space-y-4">
                {recipe.ingredients.map((ing, i) => (
                  <li key={i} className="flex items-start group">
                    <div className="mr-3 mt-1 text-primary/40 group-hover:text-primary transition-colors">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                    <div className="flex-1 text-lg">
                      <span className="font-semibold text-foreground">
                        {ing.quantity ? `${ing.quantity} ` : ''}
                        {ing.unit ? `${ing.unit} ` : ''}
                      </span>
                      <span className="text-muted-foreground">{ing.name}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            
            <Button
              variant="outline"
              className="w-full h-12 text-base gap-2 rounded-xl border-primary/20 text-primary hover:bg-primary/5 hover:text-primary"
              onClick={handleAddToGroceryList}
              disabled={isAddingToGrocery}
            >
              <CalendarPlus className="h-5 w-5" /> {isAddingToGrocery ? 'Adding...' : 'Add to Grocery List'}
            </Button>
          </div>

          {/* Instructions Side */}
          <div className="space-y-6">
            <h2 className="text-3xl font-serif text-foreground">Instructions</h2>
            <div className="space-y-8">
              {instructionsList.map((step, i) => {
                // Check if step starts with a number (e.g. "1. ")
                const match = step.match(/^(\d+)[\.\)]\s(.*)/);
                const stepNum = match ? match[1] : (i + 1).toString();
                const stepText = match ? match[2] : step;

                return (
                  <div key={i} className="flex gap-6 group">
                    <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-accent text-accent-foreground font-serif text-xl border border-border group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary transition-colors">
                      {stepNum}
                    </div>
                    <div className="pt-1.5">
                      <p className="text-lg text-foreground leading-relaxed">{stepText}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}
