import { cn } from "@/lib/utils";
import symbolLogo from "@/assets/symbol.svg";

export function BrandMark({ className }: { className?: string }) {
  return (
    <img
      src={symbolLogo}
      alt="Pika X"
      className={cn("h-5 w-auto", className)}
    />
  );
}