import { Link } from "@tanstack/react-router";
import { BrandMark } from "@/components/pika-mark";

const NAV_ITEMS = [
  { to: "/projects", label: "Projects" },
  { to: "/skills", label: "Skills" },
  { to: "/library", label: "My Library" },
] as const;

export function AppNav() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
        <Link to="/projects" className="flex items-center gap-2.5">
          <BrandMark className="h-7 w-7" />
          <span className="font-display text-lg font-semibold tracking-tight">
            Pika X
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
              activeProps={{
                className:
                  "rounded-full px-4 py-1.5 text-sm font-semibold bg-muted text-foreground",
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="w-24" />
      </div>
    </header>
  );
}