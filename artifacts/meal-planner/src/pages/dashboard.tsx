import React, { useState } from 'react';
import { useGetDashboardSummary } from '@workspace/api-client-react';
import { getWeekStart, formatWeekRange } from '@/lib/date-utils';
import { format } from 'date-fns';
import { Link } from 'wouter';
import { ArrowRight, UtensilsCrossed, Calendar, CheckCircle2, ChevronRight, Clock, ChefHat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function Dashboard() {
  const [weekStart] = useState(getWeekStart());
  const { data: summary, isLoading, isError } = useGetDashboardSummary(
    { weekStart }, 
    { query: { enabled: true, queryKey: ['dashboard', weekStart] } }
  );

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto w-full space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      <header className="space-y-2">
        <h1 className="text-4xl md:text-5xl font-serif text-foreground tracking-tight">Overview</h1>
        <p className="text-muted-foreground text-lg">
          Your week at a glance: {formatWeekRange(weekStart)}
        </p>
      </header>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => (
            <Card key={i} className="border-border shadow-sm">
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-16 mt-2" />
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : isError || !summary ? (
        <div className="p-8 bg-destructive/5 text-destructive rounded-xl border border-destructive/20">
          Failed to load dashboard. Please try again.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="bg-card shadow-sm border-border hover:border-primary/50 transition-colors">
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-primary" /> Meals Planned
                </CardDescription>
                <CardTitle className="text-4xl font-serif">{summary.mealsPlannedThisWeek}</CardTitle>
              </CardHeader>
              <CardFooter className="pt-2">
                <Link href="/meal-plan" className="text-sm text-primary hover:underline flex items-center gap-1 group">
                  View plan <ArrowRight className="h-3 w-3 group-hover:translate-x-1 transition-transform" />
                </Link>
              </CardFooter>
            </Card>

            <Card className="bg-card shadow-sm border-border hover:border-primary/50 transition-colors">
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-2">
                  <UtensilsCrossed className="h-4 w-4 text-secondary" /> Recipe Box
                </CardDescription>
                <CardTitle className="text-4xl font-serif">{summary.recipeCount}</CardTitle>
              </CardHeader>
              <CardFooter className="pt-2">
                <Link href="/recipes" className="text-sm text-secondary hover:underline flex items-center gap-1 group">
                  Browse recipes <ArrowRight className="h-3 w-3 group-hover:translate-x-1 transition-transform" />
                </Link>
              </CardFooter>
            </Card>

            <Card className="bg-card shadow-sm border-border hover:border-primary/50 transition-colors">
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-blue-500" /> Groceries
                </CardDescription>
                <CardTitle className="text-4xl font-serif">
                  {summary.groceryCheckedCount} <span className="text-xl text-muted-foreground font-sans font-normal">/ {summary.groceryItemCount}</span>
                </CardTitle>
              </CardHeader>
              <CardFooter className="pt-2">
                <Link href="/grocery-list" className="text-sm text-blue-500 hover:underline flex items-center gap-1 group">
                  Open list <ArrowRight className="h-3 w-3 group-hover:translate-x-1 transition-transform" />
                </Link>
              </CardFooter>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            {/* Today's Meals */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-serif text-foreground flex items-center gap-2">
                  Today's Plan
                </h2>
                <Link href="/meal-plan">
                  <Button variant="ghost" size="sm" className="text-muted-foreground">See all</Button>
                </Link>
              </div>
              
              {summary.todayEntries.length > 0 ? (
                <div className="space-y-3">
                  {summary.todayEntries.map((entry, i) => (
                    <div 
                      key={entry.id} 
                      className="group flex flex-col md:flex-row md:items-center gap-4 p-4 rounded-xl bg-card border border-border shadow-sm hover:shadow-md transition-all duration-300 animate-in fade-in slide-in-from-bottom-2"
                      style={{ animationDelay: `${i * 100}ms`, animationFillMode: 'both' }}
                    >
                      <div className="flex-shrink-0 w-24 flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {entry.mealSlot}
                        </span>
                        <div className="h-[1px] flex-1 bg-border ml-3 md:hidden"></div>
                      </div>
                      
                      <Link href={`/recipes/${entry.recipe.id}`} className="flex-1 min-w-0 cursor-pointer">
                        <div className="flex items-center gap-4">
                          {entry.recipe.photoUrl ? (
                            <img src={entry.recipe.photoUrl} alt={entry.recipe.title} className="w-12 h-12 rounded-md object-cover flex-shrink-0 bg-muted" />
                          ) : (
                            <div className="w-12 h-12 rounded-md bg-muted/50 flex items-center justify-center flex-shrink-0 text-muted-foreground">
                              <ChefHat className="h-5 w-5" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <h3 className="font-medium text-foreground truncate group-hover:text-primary transition-colors">
                              {entry.recipe.title}
                            </h3>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                              {(entry.recipe.prepMinutes || entry.recipe.cookMinutes) && (
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {(entry.recipe.prepMinutes || 0) + (entry.recipe.cookMinutes || 0)}m
                                </span>
                              )}
                            </div>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-primary opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />
                        </div>
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-40 flex flex-col items-center justify-center bg-card/50 border border-dashed border-border rounded-xl text-center p-6">
                  <div className="bg-muted p-3 rounded-full mb-3 text-muted-foreground">
                    <UtensilsCrossed className="h-6 w-6" />
                  </div>
                  <p className="text-muted-foreground mb-4">Nothing planned for today.</p>
                  <Link href="/meal-plan">
                    <Button variant="outline" size="sm">Plan a meal</Button>
                  </Link>
                </div>
              )}
            </section>

            {/* Recent Recipes */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-serif text-foreground">Recently Added</h2>
                <Link href="/recipes">
                  <Button variant="ghost" size="sm" className="text-muted-foreground">View box</Button>
                </Link>
              </div>

              {summary.recentRecipes.length > 0 ? (
                <div className="grid grid-cols-2 gap-4">
                  {summary.recentRecipes.slice(0, 4).map((recipe, i) => (
                    <Link key={recipe.id} href={`/recipes/${recipe.id}`}>
                      <div 
                        className="group relative rounded-xl overflow-hidden bg-card border border-border shadow-sm hover:shadow-md transition-all cursor-pointer aspect-square sm:aspect-auto sm:h-36 animate-in fade-in zoom-in-95 duration-500"
                        style={{ animationDelay: `${200 + i * 100}ms`, animationFillMode: 'both' }}
                      >
                        {recipe.photoUrl ? (
                          <img src={recipe.photoUrl} alt={recipe.title} className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                        ) : (
                          <div className="absolute inset-0 bg-secondary/10 flex items-center justify-center text-secondary/40 transition-transform duration-700 group-hover:scale-105">
                            <ChefHat className="h-10 w-10" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-end p-4">
                          <h3 className="text-white font-medium line-clamp-2 leading-tight">
                            {recipe.title}
                          </h3>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="h-40 flex flex-col items-center justify-center bg-card/50 border border-dashed border-border rounded-xl text-center p-6">
                  <p className="text-muted-foreground mb-4">Your recipe box is empty.</p>
                  <Link href="/recipes/new">
                    <Button variant="outline" size="sm">Add first recipe</Button>
                  </Link>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
