import React, { useState } from 'react';
import { 
  useListMealPlanEntries, 
  useCreateMealPlanEntry, 
  useDeleteMealPlanEntry,
  useListRecipes,
  useGetRecipe,
  getListMealPlanEntriesQueryKey,
  getGetRecipeQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { format, addDays, isSameDay } from 'date-fns';
import { getWeekStart, getNextWeekStart, getPrevWeekStart, formatWeekRange } from '@/lib/date-utils';
import { ChevronLeft, ChevronRight, Plus, ChefHat, Trash2, Clock, X, CalendarPlus, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MealSlot, MealPlanEntry, RecipeSummary } from '@workspace/api-client-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/hooks/use-debounce';
import { Link, useSearch, useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';

const SLOTS = [MealSlot.breakfast, MealSlot.lunch, MealSlot.dinner, MealSlot.snack];

export default function MealPlan() {
  const [weekStart, setWeekStart] = useState(getWeekStart());
  const endDate = format(addDays(new Date(weekStart), 6), 'yyyy-MM-dd');
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const search = useSearch();
  const [, setLocation] = useLocation();

  // Support arriving from "Add to Plan" on a recipe (?recipe=<id>): preselect
  // that recipe so the next slot the user clicks assigns it directly.
  const preselectedRecipeId = (() => {
    const raw = new URLSearchParams(search).get('recipe');
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return isNaN(parsed) ? null : parsed;
  })();
  const { data: preselectedRecipe } = useGetRecipe(preselectedRecipeId ?? 0, {
    query: { queryKey: getGetRecipeQueryKey(preselectedRecipeId ?? 0), enabled: preselectedRecipeId !== null },
  });

  const { data: entries = [], isLoading } = useListMealPlanEntries(
    { startDate: weekStart, endDate: endDate },
    { query: { queryKey: getListMealPlanEntriesQueryKey({ startDate: weekStart, endDate: endDate }) } }
  );

  const createEntry = useCreateMealPlanEntry();
  const deleteEntry = useDeleteMealPlanEntry();

  const [activeSlot, setActiveSlot] = useState<{ date: string, slot: MealSlot } | null>(null);

  const clearPreselected = () => setLocation('/meal-plan');

  const handleAssignRecipe = (date: string, slot: MealSlot, recipeId: number) => {
    createEntry.mutate(
      { data: { date, mealSlot: slot, recipeId } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMealPlanEntriesQueryKey({ startDate: weekStart, endDate: endDate }) });
          toast({ title: "Added to plan", description: "Your meal plan has been updated." });
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to add recipe to the plan.", variant: "destructive" });
        }
      }
    );
  };

  const handleSlotClick = (date: string, slot: MealSlot) => {
    if (preselectedRecipeId !== null) {
      handleAssignRecipe(date, slot, preselectedRecipeId);
      clearPreselected();
      return;
    }
    setActiveSlot({ date, slot });
  };
  
  const handlePrevWeek = () => setWeekStart(getPrevWeekStart(weekStart));
  const handleNextWeek = () => setWeekStart(getNextWeekStart(weekStart));
  const handleToday = () => setWeekStart(getWeekStart());

  // Generate days array for the week
  const days = Array.from({ length: 7 }).map((_, i) => {
    const d = addDays(new Date(weekStart), i);
    return {
      date: format(d, 'yyyy-MM-dd'),
      dayName: format(d, 'EEE'),
      dayNum: format(d, 'd'),
      isToday: isSameDay(d, new Date())
    };
  });

  /**
   * Totals a day's planned meals.
   *
   * `known` vs the entry count is the point: a recipe with no nutrition recorded contributes
   * nothing, and showing a confident total that quietly omits it would understate the day.
   * The UI says how many of the day's meals the figure actually covers.
   *
   * An entry's own `servings` overrides one portion — planning two servings of something
   * doubles its contribution.
   */
  const getDayTotals = (date: string) => {
    const dayEntries = entries.filter(e => e.date.slice(0, 10) === date);
    let calories = 0, proteinG = 0, carbsG = 0, fatG = 0, known = 0;

    for (const entry of dayEntries) {
      const n = entry.recipe.nutrition;
      if (!n || n.calories == null) continue;
      const portions = entry.servings ?? 1;
      calories += n.calories * portions;
      proteinG += (n.proteinG ?? 0) * portions;
      carbsG += (n.carbsG ?? 0) * portions;
      fatG += (n.fatG ?? 0) * portions;
      known += 1;
    }

    return { calories: Math.round(calories), proteinG, carbsG, fatG, known, total: dayEntries.length };
  };

  const getEntryForSlot = (date: string, slot: MealSlot) => {
    return entries.find(e => e.date.slice(0, 10) === date && e.mealSlot === slot);
  };

  const handleSelectRecipe = (recipeId: number) => {
    if (!activeSlot) return;
    handleAssignRecipe(activeSlot.date, activeSlot.slot, recipeId);
    setActiveSlot(null);
  };

  const handleDeleteEntry = (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    e.stopPropagation();
    deleteEntry.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMealPlanEntriesQueryKey({ startDate: weekStart, endDate: endDate }) });
        }
      }
    );
  };

  return (
    <div className="p-6 md:p-10 max-w-[1400px] mx-auto w-full flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-8">
        <div>
          <h1 className="text-4xl md:text-5xl font-serif text-foreground tracking-tight mb-2">Meal Plan</h1>
          <p className="text-muted-foreground text-lg">Organize your cooking for the week.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-card border border-border p-1 rounded-xl shadow-sm">
            <Button variant="ghost" size="icon" onClick={handlePrevWeek} className="rounded-lg">
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button variant="ghost" className="font-medium text-foreground min-w-[160px] rounded-lg" onClick={handleToday}>
              {formatWeekRange(weekStart)}
            </Button>
            <Button variant="ghost" size="icon" onClick={handleNextWeek} className="rounded-lg">
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
          <Link href={`/meal-plan/generate?weekStart=${weekStart}`}>
            <Button size="lg" variant="outline" className="shadow-sm gap-2">
              <Wand2 className="h-5 w-5" /> Generate with AI
            </Button>
          </Link>
        </div>
      </div>

      {preselectedRecipeId !== null && (
        <div className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-primary/30 bg-primary/5 px-5 py-3">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <CalendarPlus className="h-4 w-4 text-primary" />
            <span>
              Placing <span className="font-semibold">{preselectedRecipe?.title ?? 'recipe'}</span> — tap an empty slot below to add it.
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={clearPreselected} className="gap-1 text-muted-foreground">
            <X className="h-4 w-4" /> Cancel
          </Button>
        </div>
      )}

      {/* Grid */}
      <div className="flex-1 overflow-auto min-h-0 bg-card border border-border rounded-2xl shadow-sm">
        <div className="min-w-[800px] h-full flex flex-col">
          {/* Header Row */}
          <div className="grid grid-cols-[100px_repeat(7,1fr)] border-b border-border bg-accent/30 sticky top-0 z-10">
            <div className="p-4 border-r border-border flex items-center justify-center">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Slot</span>
            </div>
            {days.map(day => (
              <div 
                key={day.date} 
                className={`p-4 flex flex-col items-center justify-center border-r border-border last:border-r-0 ${day.isToday ? 'bg-primary/5' : ''}`}
              >
                <span className={`text-sm font-medium ${day.isToday ? 'text-primary' : 'text-muted-foreground'}`}>{day.dayName}</span>
                <span className={`text-2xl font-serif mt-1 ${day.isToday ? 'text-primary font-semibold' : 'text-foreground'}`}>
                  {day.dayNum}
                </span>
                {day.isToday && <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1"></span>}
              </div>
            ))}
          </div>

          {/* Slots Rows */}
          {isLoading ? (
            <div className="p-8 space-y-4">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <div className="flex-1 flex flex-col">
              {SLOTS.map((slot, idx) => (
                <div key={slot} className="grid grid-cols-[100px_repeat(7,1fr)] flex-1 min-h-[140px] border-b border-border last:border-b-0">
                  <div className="p-4 border-r border-border flex flex-col items-center justify-center bg-accent/10">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground rotate-180" style={{ writingMode: 'vertical-rl' }}>
                      {slot}
                    </span>
                  </div>
                  
                  {days.map(day => {
                    const entry = getEntryForSlot(day.date, slot);
                    
                    return (
                      <div 
                        key={`${day.date}-${slot}`}
                        className={`border-r border-border last:border-r-0 p-2 relative group transition-colors hover:bg-accent/30 ${day.isToday ? 'bg-primary/[0.02]' : ''}`}
                      >
                        {entry ? (
                          <Link href={`/recipes/${entry.recipe.id}`}>
                            <div className="h-full w-full rounded-xl bg-background border border-border p-3 shadow-sm hover:shadow-md hover:border-primary/50 transition-all cursor-pointer flex flex-col">
                              <div className="flex justify-between items-start mb-2">
                                <h4 className="font-medium text-sm leading-tight text-foreground line-clamp-2">
                                  {entry.recipe.title}
                                </h4>
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-6 w-6 -mr-1 -mt-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={(e) => handleDeleteEntry(e, entry.id)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                              <div className="mt-auto">
                                {entry.recipe.photoUrl && (
                                  <div className="w-full h-16 rounded-md overflow-hidden bg-muted mt-2">
                                    <img src={entry.recipe.photoUrl} alt="" className="w-full h-full object-cover" />
                                  </div>
                                )}
                              </div>
                            </div>
                          </Link>
                        ) : (
                          <div 
                            className={`h-full w-full rounded-xl border border-transparent hover:border-dashed hover:border-primary/40 hover:bg-primary/5 flex items-center justify-center cursor-pointer transition-all ${preselectedRecipeId !== null ? 'opacity-100 border-dashed border-primary/30 bg-primary/5' : 'opacity-0 group-hover:opacity-100'}`}
                            onClick={() => handleSlotClick(day.date, slot)}
                          >
                            <div className="bg-background rounded-full p-2 text-primary shadow-sm">
                              <Plus className="h-4 w-4" />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}

              <div className="grid grid-cols-[100px_repeat(7,1fr)] border-t-2 border-border bg-accent/20">
                <div className="p-3 border-r border-border flex items-center justify-center">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center">
                    Per day
                  </span>
                </div>
                {days.map(day => {
                  const totals = getDayTotals(day.date);
                  if (totals.total === 0) {
                    return <div key={`tot-${day.date}`} className="p-3 border-r border-border last:border-r-0" />;
                  }
                  return (
                    <div
                      key={`tot-${day.date}`}
                      className={`p-3 border-r border-border last:border-r-0 text-center ${day.isToday ? 'bg-primary/5' : ''}`}
                    >
                      <div className="text-lg font-serif text-foreground">
                        {totals.known === 0 ? '--' : `${totals.calories}`}
                        {totals.known > 0 && <span className="text-xs text-muted-foreground ml-1">cal</span>}
                      </div>
                      {totals.known > 0 && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {Math.round(totals.proteinG)}p · {Math.round(totals.carbsG)}c · {Math.round(totals.fatG)}f
                        </div>
                      )}
                      {totals.known < totals.total && (
                        <div className="text-[10px] text-muted-foreground/80 mt-1" title="Some meals have no nutrition recorded">
                          {totals.known} of {totals.total} meals
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <RecipeSelectorDialog 
        isOpen={!!activeSlot} 
        onClose={() => setActiveSlot(null)} 
        onSelect={handleSelectRecipe}
        slotInfo={activeSlot}
      />
    </div>
  );
}

function RecipeSelectorDialog({ 
  isOpen, 
  onClose, 
  onSelect, 
  slotInfo 
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  onSelect: (id: number) => void,
  slotInfo: { date: string, slot: MealSlot } | null
}) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  
  const { data: recipes, isLoading } = useListRecipes(
    { search: debouncedSearch || undefined },
    { query: { enabled: isOpen, queryKey: ['recipes-picker', debouncedSearch] } }
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden bg-card">
        <div className="p-6 pb-4 bg-background border-b border-border">
          <DialogHeader>
            <DialogTitle className="text-xl font-serif">Select Recipe</DialogTitle>
            <DialogDescription>
              {slotInfo && `For ${format(new Date(slotInfo.date), 'EEEE, MMM d')} - ${slotInfo.slot.charAt(0).toUpperCase() + slotInfo.slot.slice(1)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 relative">
            <Input 
              placeholder="Search recipes..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-card border-border"
            />
          </div>
        </div>
        
        <ScrollArea className="h-[400px] p-2">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
            </div>
          ) : !recipes || recipes.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground flex flex-col items-center">
              <ChefHat className="h-8 w-8 mb-2 opacity-20" />
              <p>No recipes found.</p>
              {search && <Button variant="link" onClick={() => setSearch('')}>Clear search</Button>}
            </div>
          ) : (
            <div className="p-2 space-y-2">
              {recipes.map(recipe => (
                <div 
                  key={recipe.id}
                  className="flex items-center p-3 rounded-lg hover:bg-accent/50 cursor-pointer transition-colors border border-transparent hover:border-border"
                  onClick={() => onSelect(recipe.id)}
                >
                  {recipe.photoUrl ? (
                    <img src={recipe.photoUrl} alt="" className="h-12 w-12 rounded-md object-cover mr-4 border border-border" />
                  ) : (
                    <div className="h-12 w-12 rounded-md bg-muted flex items-center justify-center mr-4 border border-border text-muted-foreground/50">
                      <ChefHat className="h-5 w-5" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-foreground truncate">{recipe.title}</h4>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <Clock className="h-3 w-3" /> 
                      {(recipe.prepMinutes || 0) + (recipe.cookMinutes || 0)}m
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" className="text-primary hover:bg-primary/10">Add</Button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
