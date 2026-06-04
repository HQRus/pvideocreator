import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative grid h-8 w-8 place-items-center rounded-lg bg-brand-gradient shadow-glow",
        className,
      )}
    >
      <Play className="h-4 w-4 fill-primary-foreground text-primary-foreground" />
    </span>
  );
}