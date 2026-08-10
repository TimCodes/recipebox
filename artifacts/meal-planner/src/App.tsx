import React from 'react';
import { Switch, Route } from 'wouter';
import Dashboard from './pages/dashboard';
import RecipesList from './pages/recipes-list';
import RecipeDetail from './pages/recipe-detail';
import RecipeForm from './pages/recipe-form';
import RecipeImport from './pages/recipe-import';
import MealPlan from './pages/meal-plan';
import GroceryList from './pages/grocery-list';
import { Shell } from './components/shell';
import NotFound from './pages/not-found';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/recipes" component={RecipesList} />
        <Route path="/recipes/new" component={RecipeForm} />
        <Route path="/recipes/import" component={RecipeImport} />
        <Route path="/recipes/:id/edit" component={RecipeForm} />
        <Route path="/recipes/:id" component={RecipeDetail} />
        <Route path="/meal-plan" component={MealPlan} />
        <Route path="/grocery-list" component={GroceryList} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
