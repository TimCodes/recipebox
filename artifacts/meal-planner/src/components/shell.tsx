import React from 'react';
import { Link, useLocation } from 'wouter';
import { ChefHat, CalendarDays, ListChecks, BookOpen, Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

const NAV_ITEMS = [
  { href: '/', label: 'Overview', icon: BookOpen },
  { href: '/recipes', label: 'Recipe Box', icon: ChefHat },
  { href: '/meal-plan', label: 'Meal Plan', icon: CalendarDays },
  { href: '/grocery-list', label: 'Grocery List', icon: ListChecks },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-background">
      {/* Mobile Navbar */}
      <div className="md:hidden flex items-center justify-between p-4 border-b border-border bg-card sticky top-0 z-50">
        <div className="flex items-center gap-2 font-serif text-lg text-foreground">
          <div className="bg-primary/10 p-1.5 rounded-md text-primary">
            <ChefHat className="h-5 w-5" />
          </div>
          Kitchen Notebook
        </div>
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground">
              <Menu className="h-6 w-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[280px] p-0 border-l border-border bg-card">
            <div className="p-6 flex flex-col h-full">
              <div className="flex items-center justify-between mb-8">
                <span className="font-serif text-xl">Menu</span>
                <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)}>
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <nav className="flex flex-col gap-2">
                {NAV_ITEMS.map((item) => (
                  <Link key={item.href} href={item.href} onClick={() => setIsOpen(false)}>
                    <div
                      className={cn(
                        "flex items-center gap-3 px-4 py-3 rounded-lg text-base transition-colors",
                        location === item.href || (item.href !== '/' && location.startsWith(item.href))
                          ? "bg-primary text-primary-foreground font-medium shadow-sm"
                          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      )}
                    >
                      <item.icon className="h-5 w-5" />
                      {item.label}
                    </div>
                  </Link>
                ))}
              </nav>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-[260px] border-r border-border bg-card sticky top-0 h-[100dvh] overflow-y-auto">
        <div className="p-6">
          <Link href="/">
            <div className="flex items-center gap-3 font-serif text-xl text-foreground cursor-pointer group">
              <div className="bg-primary/10 p-2 rounded-lg text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                <ChefHat className="h-6 w-6" />
              </div>
              Kitchen Notebook
            </div>
          </Link>
        </div>
        
        <nav className="flex-1 px-4 py-4 flex flex-col gap-1.5">
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.href || (item.href !== '/' && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all duration-200 cursor-pointer",
                    isActive
                      ? "bg-primary text-primary-foreground font-medium shadow-sm"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <item.icon className={cn("h-4 w-4", isActive ? "text-primary-foreground" : "text-muted-foreground/70")} />
                  {item.label}
                </div>
              </Link>
            )
          })}
        </nav>
        
        <div className="p-6 border-t border-border mt-auto">
          <div className="bg-accent/50 rounded-xl p-4 text-sm text-muted-foreground border border-border/50 shadow-sm">
            <p className="font-serif text-foreground mb-1">Happy Cooking!</p>
            <p className="text-xs">Your personal recipe box and weekly planner.</p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 flex flex-col">
        {children}
      </main>
    </div>
  );
}
