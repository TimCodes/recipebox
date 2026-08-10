import React, { useState } from 'react';
import { 
  useListGroceryListItems, 
  useCreateGroceryListItem, 
  useUpdateGroceryListItem, 
  useDeleteGroceryListItem,
  useGenerateGroceryList,
  getListGroceryListItemsQueryKey
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { getWeekStart, getNextWeekStart, getPrevWeekStart, formatWeekRange } from '@/lib/date-utils';
import { IngredientCategory, GroceryListItem } from '@workspace/api-client-react';
import { ChevronLeft, ChevronRight, Plus, Trash2, RefreshCw, CheckCircle2, Circle, ListChecks, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Group items by category
const CATEGORY_ORDER = [
  IngredientCategory.produce,
  IngredientCategory.meat_seafood,
  IngredientCategory.dairy,
  IngredientCategory.bakery,
  IngredientCategory.pantry,
  IngredientCategory.frozen,
  IngredientCategory.beverages,
  IngredientCategory.spices,
  IngredientCategory.other
];

const CATEGORY_LABELS: Record<string, string> = {
  [IngredientCategory.produce]: "Produce",
  [IngredientCategory.meat_seafood]: "Meat & Seafood",
  [IngredientCategory.dairy]: "Dairy & Eggs",
  [IngredientCategory.bakery]: "Bakery",
  [IngredientCategory.pantry]: "Pantry",
  [IngredientCategory.frozen]: "Frozen",
  [IngredientCategory.beverages]: "Beverages",
  [IngredientCategory.spices]: "Spices & Herbs",
  [IngredientCategory.other]: "Other"
};

export default function GroceryList() {
  const [weekStart, setWeekStart] = useState(getWeekStart());
  const queryClient = useQueryClient();
  
  const { data: items = [], isLoading } = useListGroceryListItems(
    { weekStart },
    { query: { queryKey: getListGroceryListItemsQueryKey({ weekStart }) } }
  );

  const generateList = useGenerateGroceryList();
  const updateItem = useUpdateGroceryListItem();
  const deleteItem = useDeleteGroceryListItem();
  const createItem = useCreateGroceryListItem();

  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState<IngredientCategory>(IngredientCategory.produce);

  const handleGenerate = () => {
    generateList.mutate(
      { data: { weekStart } },
      { onSuccess: () => invalidateList() }
    );
  };

  const handleToggle = (item: GroceryListItem) => {
    // Optimistic update
    queryClient.setQueryData(
      getListGroceryListItemsQueryKey({ weekStart }), 
      (old: GroceryListItem[] | undefined) => old?.map(i => i.id === item.id ? { ...i, checked: !i.checked } : i)
    );
    
    updateItem.mutate(
      { id: item.id, data: { checked: !item.checked } },
      { onError: () => invalidateList() } // revert on error
    );
  };

  const handleDelete = (id: number) => {
    deleteItem.mutate({ id }, { onSuccess: () => invalidateList() });
  };

  const handleAddManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) return;
    
    createItem.mutate(
      { data: { name: newItemName.trim(), weekStart, category: newItemCategory } },
      { 
        onSuccess: () => {
          setNewItemName('');
          invalidateList();
        } 
      }
    );
  };

  const invalidateList = () => {
    queryClient.invalidateQueries({ queryKey: getListGroceryListItemsQueryKey({ weekStart }) });
  };

  // Group items
  const groupedItems = CATEGORY_ORDER.map(cat => ({
    category: cat,
    label: CATEGORY_LABELS[cat],
    items: items.filter(i => i.category === cat)
  })).filter(g => g.items.length > 0);

  const totalItems = items.length;
  const checkedItems = items.filter(i => i.checked).length;
  const progress = totalItems === 0 ? 0 : Math.round((checkedItems / totalItems) * 100);

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto w-full animate-in fade-in slide-in-from-bottom-4 duration-500 pb-24">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-8">
        <div>
          <h1 className="text-4xl md:text-5xl font-serif text-foreground tracking-tight mb-2">Grocery List</h1>
          <p className="text-muted-foreground text-lg">Shop for the week of {formatWeekRange(weekStart)}</p>
        </div>
        
        <div className="flex items-center gap-2 bg-card border border-border p-1 rounded-xl shadow-sm">
          <Button variant="ghost" size="icon" onClick={() => setWeekStart(getPrevWeekStart(weekStart))} className="rounded-lg">
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button variant="ghost" className="font-medium text-foreground min-w-[140px] rounded-lg" onClick={() => setWeekStart(getWeekStart())}>
            This Week
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setWeekStart(getNextWeekStart(weekStart))} className="rounded-lg">
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-8 items-start">
        
        {/* Main List */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex-1 max-w-xs h-2 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary transition-all duration-500 ease-out" 
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <span className="text-sm font-medium text-muted-foreground ml-4">
              {checkedItems} / {totalItems} gathered
            </span>
          </div>

          {isLoading ? (
            <div className="space-y-6">
              {[1, 2].map(i => (
                <div key={i} className="space-y-3">
                  <Skeleton className="h-6 w-32 mb-2" />
                  {[1, 2, 3].map(j => <Skeleton key={j} className="h-14 w-full rounded-xl" />)}
                </div>
              ))}
            </div>
          ) : totalItems === 0 ? (
            <div className="py-16 text-center flex flex-col items-center justify-center bg-card/50 border border-dashed border-border rounded-2xl">
              <div className="bg-secondary/10 p-5 rounded-full text-secondary mb-4">
                <ListChecks className="h-10 w-10" />
              </div>
              <h3 className="text-xl font-serif text-foreground mb-2">Your list is empty</h3>
              <p className="text-muted-foreground mb-6 max-w-sm">
                Generate a list from this week's meal plan, or start adding items manually below.
              </p>
              <Button onClick={handleGenerate} disabled={generateList.isPending} className="shadow-sm gap-2">
                {generateList.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                Auto-generate from Meal Plan
              </Button>
            </div>
          ) : (
            <div className="space-y-8">
              {groupedItems.map(group => (
                <div key={group.category} className="space-y-3 animate-in fade-in">
                  <h3 className="font-serif text-xl text-foreground flex items-center gap-2 border-b border-border pb-2">
                    {group.label}
                    <span className="text-sm font-sans font-normal text-muted-foreground bg-accent px-2 py-0.5 rounded-full">
                      {group.items.length}
                    </span>
                  </h3>
                  
                  <div className="grid gap-2">
                    {group.items.map(item => (
                      <div 
                        key={item.id}
                        className={cn(
                          "flex items-center gap-4 p-3 rounded-xl border transition-all duration-200 group cursor-pointer",
                          item.checked 
                            ? "bg-accent/30 border-transparent opacity-60" 
                            : "bg-card border-border hover:border-primary/30 shadow-sm"
                        )}
                        onClick={() => handleToggle(item)}
                      >
                        <Checkbox 
                          checked={item.checked} 
                          onCheckedChange={() => handleToggle(item)}
                          className={cn(
                            "h-5 w-5 rounded-md transition-colors",
                            item.checked ? "data-[state=checked]:bg-secondary data-[state=checked]:text-secondary-foreground border-secondary" : ""
                          )}
                        />
                        
                        <div className={cn(
                          "flex-1 text-base transition-all",
                          item.checked ? "line-through text-muted-foreground" : "text-foreground font-medium"
                        )}>
                          {item.name}
                        </div>
                        
                        {item.quantity && (
                          <div className={cn(
                            "text-sm font-medium px-2 py-1 rounded-md",
                            item.checked ? "text-muted-foreground" : "bg-primary/10 text-primary"
                          )}>
                            {item.quantity} {item.unit}
                          </div>
                        )}
                        
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                          onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar Actions */}
        <div className="space-y-6 sticky top-24">
          <div className="bg-card border border-border p-5 rounded-2xl shadow-sm">
            <h3 className="font-serif text-lg text-foreground mb-4">Add Item</h3>
            <form onSubmit={handleAddManual} className="space-y-3">
              <Input 
                placeholder="Item name (e.g. Milk)" 
                value={newItemName}
                onChange={e => setNewItemName(e.target.value)}
                className="bg-background"
              />
              <Select value={newItemCategory} onValueChange={(v) => setNewItemCategory(v as IngredientCategory)}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_ORDER.map(cat => (
                    <SelectItem key={cat} value={cat}>{CATEGORY_LABELS[cat]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="submit" className="w-full gap-2 mt-2" disabled={!newItemName.trim() || createItem.isPending}>
                <Plus className="h-4 w-4" /> Add to List
              </Button>
            </form>
          </div>

          <div className="bg-card border border-border p-5 rounded-2xl shadow-sm">
            <h3 className="font-serif text-lg text-foreground mb-2 flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-primary" /> Auto-Sync
            </h3>
            <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
              Pull ingredients directly from the meals you planned for this week.
            </p>
            <Button 
              variant="outline" 
              className="w-full gap-2 border-primary/20 text-primary hover:bg-primary/5 hover:text-primary" 
              onClick={handleGenerate}
              disabled={generateList.isPending}
            >
              {generateList.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Sync Meal Plan
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}
