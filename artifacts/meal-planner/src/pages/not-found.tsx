import { useLocation } from "wouter";
import { Link } from "wouter";
import { ChefHat } from "lucide-react";

export default function NotFound() {
  const [location] = useLocation();

  return (
    <div className="min-h-[80vh] flex items-center justify-center bg-background text-foreground p-6">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="flex justify-center mb-6">
          <div className="bg-primary/10 p-6 rounded-full text-primary">
            <ChefHat className="h-16 w-16" />
          </div>
        </div>
        <h1 className="text-4xl md:text-5xl font-serif font-medium">Page Not Found</h1>
        <p className="text-lg text-muted-foreground">
          Oops! We couldn't find the page <code className="bg-accent px-1.5 py-0.5 rounded text-sm text-foreground">{location}</code>.
        </p>
        <div className="pt-4">
          <Link href="/" className="inline-flex items-center justify-center h-12 px-8 rounded-xl bg-primary text-primary-foreground font-medium shadow-sm hover:bg-primary/90 transition-colors">
            Return to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
