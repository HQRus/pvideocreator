import { cn } from "@/lib/utils";
import symbolLogo from "@/assets/symbol.svg";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative grid h-8 w-8 place-items-center rounded-lg bg-brand-gradient shadow-glow",
        className,
      )}
    >
      <img
        src={symbolLogo}
        alt="Pika X"
        className="h-[14px] w-auto brightness-0 invert"
      />
    </span>
  );
}