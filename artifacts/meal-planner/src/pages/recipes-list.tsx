import React, { useState } from 'react';
import { useListRecipes, useListRecipeTags } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Search, Plus, ChefHat, Clock, Users, SlidersHorizontal, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDebounce } from '@/hooks/use-debounce';

export default function RecipesList() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | undefined>(undefined);
  
  const debouncedSearch = useDebounce(searchTerm, 300);

  const { data: recipes, isLoading } = useListRecipes(
    { search: debouncedSearch || undefined, tag: selectedTag },
    { query: { queryKey: ['recipes', debouncedSearch, selectedTag] } }
  );

  const { data: tags = [] } = useListRecipeTags({
    query: { queryKey: ['recipeTags'] }
  });

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto w-full space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-4xl md:text-5xl font-serif text-foreground tracking-tight mb-2">Recipe Box</h1>
          <p className="text-muted-foreground text-lg">Your personal collection of favorite meals.</p>
        </div>
        <Link href="/recipes/new">
          <Button size="lg" className="w-full md:w-auto shadow-sm gap-2">
            <Plus className="h-5 w-5" /> Add Recipe
          </Button>
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input 
            placeholder="Search by title, ingredient..." 
            className="pl-10 h-12 bg-card border-border text-base shadow-sm rounded-xl focus-visible:ring-primary"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="h-12 gap-2 rounded-xl border-border bg-card shadow-sm">
              <SlidersHorizontal className="h-4 w-4" /> 
              {selectedTag ? `Tag: ${selectedTag}` : 'Filter'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[280px] p-4" align="end">
            <h4 className="font-medium mb-3 text-sm">Filter by Tag</h4>
            <div className="flex flex-wrap gap-2">
              <Badge 
                variant={!selectedTag ? "default" : "outline"} 
                className="cursor-pointer"
                onClick={() => setSelectedTag(undefined)}
              >
                All Recipes
              </Badge>
              {tags.map(tag => (
                <Badge 
                  key={tag}
                  variant={selectedTag === tag ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => setSelectedTag(tag)}
                >
                  {tag}
                </Badge>
              ))}
            </div>
            {tags.length === 0 && <p className="text-sm text-muted-foreground">No tags found.</p>}
          </PopoverContent>
        </Popover>
      </div>

      {(searchTerm || selectedTag) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Showing results for</span>
          {searchTerm && <span className="text-foreground font-medium">"{searchTerm}"</span>}
          {searchTerm && selectedTag && <span>and</span>}
          {selectedTag && (
            <Badge variant="secondary" className="gap-1 px-2 py-0.5">
              {selectedTag}
              <X className="h-3 w-3 cursor-pointer ml-1" onClick={() => setSelectedTag(undefined)} />
            </Badge>
          )}
          {recipes && <span>({recipes.length})</span>}
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="flex flex-col gap-3">
              <Skeleton className="h-48 w-full rounded-2xl" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      ) : !recipes || recipes.length === 0 ? (
        <div className="py-20 text-center flex flex-col items-center justify-center max-w-md mx-auto">
          <div className="bg-secondary/10 p-6 rounded-full text-secondary mb-6">
            <ChefHat className="h-12 w-12" />
          </div>
          <h3 className="text-2xl font-serif text-foreground mb-2">No recipes found</h3>
          <p className="text-muted-foreground mb-8 text-lg">
            {searchTerm || selectedTag 
              ? "We couldn't find anything matching your search. Try adjusting your filters." 
              : "Your recipe box is empty. Start adding your favorite meals!"}
          </p>
          {searchTerm || selectedTag ? (
            <Button variant="outline" onClick={() => { setSearchTerm(''); setSelectedTag(undefined); }}>
              Clear Filters
            </Button>
          ) : (
            <Link href="/recipes/new">
              <Button size="lg" className="shadow-sm gap-2">
                <Plus className="h-5 w-5" /> Add Your First Recipe
              </Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {recipes.map((recipe, index) => (
            <Link key={recipe.id} href={`/recipes/${recipe.id}`}>
              <div 
                className="group flex flex-col h-full bg-card rounded-2xl border border-border overflow-hidden shadow-sm hover:shadow-md hover:border-primary/40 transition-all duration-300 animate-in fade-in zoom-in-95 cursor-pointer"
                style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'both' }}
              >
                <div className="relative aspect-[4/3] overflow-hidden bg-muted">
                  {recipe.photoUrl ? (
                    <img 
                      src={recipe.photoUrl} 
                      alt={recipe.title} 
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" 
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/30 transition-transform duration-700 group-hover:scale-105 group-hover:text-primary/20">
                      <ChefHat className="h-16 w-16" />
                    </div>
                  )}
                  {recipe.tags && recipe.tags.length > 0 && (
                    <div className="absolute bottom-3 left-3 flex flex-wrap gap-1">
                      {recipe.tags.slice(0, 2).map(tag => (
                        <Badge key={tag} className="bg-background/90 text-foreground border-none shadow-sm backdrop-blur-sm px-2 py-0.5 font-medium">
                          {tag}
                        </Badge>
                      ))}
                      {recipe.tags.length > 2 && (
                        <Badge className="bg-background/90 text-foreground border-none shadow-sm backdrop-blur-sm px-1.5 py-0.5">
                          +{recipe.tags.length - 2}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
                <div className="p-5 flex flex-col flex-1">
                  <h3 className="text-lg font-serif font-medium text-foreground line-clamp-2 mb-3 group-hover:text-primary transition-colors">
                    {recipe.title}
                  </h3>
                  
                  <div className="mt-auto flex items-center gap-4 text-sm text-muted-foreground">
                    {(recipe.prepMinutes !== null || recipe.cookMinutes !== null) && (
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-4 w-4" />
                        <span>{(recipe.prepMinutes || 0) + (recipe.cookMinutes || 0)}m</span>
                      </div>
                    )}
                    {recipe.servings !== null && (
                      <div className="flex items-center gap-1.5">
                        <Users className="h-4 w-4" />
                        <span>{recipe.servings}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
