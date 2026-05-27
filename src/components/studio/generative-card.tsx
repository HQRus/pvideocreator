import DOMPurify from "isomorphic-dompurify";
import { useEffect, useRef } from "react";

const SANITIZE_CONFIG = {
  ADD_ATTR: [
    "data-card",
    "data-card-title",
    "data-action",
    "data-value",
    "data-pill",
  ],
  FORBID_TAGS: ["script", "style", "link", "iframe", "object", "embed"],
  FORBID_ATTR: ["style", "onclick", "onsubmit", "onload", "onerror"],
};

export function extractCardTitle(html: string): string {
  const m = html.match(/data-card-title=["']([^"']+)["']/);
  return m ? m[1] : "Card";
}

export function stripCardWrapper(html: string): string {
  // strip a leading ```html fence or stray text the model may emit
  const fence = html.match(/```(?:html)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const start = html.indexOf("<div");
  if (start > 0) return html.slice(start);
  return html;
}

export function GenerativeCard({
  html,
  onAnswer,
  disabled,
}: {
  html: string;
  onAnswer: (text: string) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cleaned = stripCardWrapper(html);
  const safe = DOMPurify.sanitize(cleaned, SANITIZE_CONFIG);

  useEffect(() => {
    const root = ref.current;
    if (!root || disabled) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const btn = target.closest<HTMLElement>('[data-action="answer"]');
      if (!btn || btn.tagName !== "BUTTON") return;
      // ignore submit buttons inside forms — let the form handler take it
      if (btn.closest("form")) return;
      e.preventDefault();
      const value =
        btn.getAttribute("data-value") ?? btn.textContent?.trim() ?? "";
      if (value) onAnswer(value);
    };

    const handleSubmit = (e: Event) => {
      const form = e.target as HTMLFormElement;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.getAttribute("data-action") !== "answer") return;
      e.preventDefault();
      const data = new FormData(form);
      const pairs: string[] = [];
      for (const [k, v] of data.entries()) {
        const val = String(v).trim();
        if (val) pairs.push(`${k}: ${val}`);
      }
      onAnswer(pairs.length ? pairs.join(" · ") : "Submitted");
    };

    root.addEventListener("click", handleClick);
    root.addEventListener("submit", handleSubmit);
    return () => {
      root.removeEventListener("click", handleClick);
      root.removeEventListener("submit", handleSubmit);
    };
  }, [onAnswer, disabled, safe]);

  return (
    <div
      ref={ref}
      className="generative-card w-full rounded-3xl border border-border bg-card p-6 text-base leading-relaxed shadow-elegant sm:p-8"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}

export function DecisionPill({
  title,
  answer,
}: {
  title: string;
  answer: string;
}) {
  return (
    <div className="flex items-center gap-2 self-start rounded-full border border-border bg-muted/50 px-4 py-2 text-sm">
      <span className="font-medium text-muted-foreground">{title}</span>
      <span className="text-muted-foreground/60">·</span>
      <span className="truncate text-foreground">{answer}</span>
    </div>
  );
}

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="ml-auto max-w-[80%] rounded-3xl bg-secondary px-5 py-3.5 text-base leading-snug text-foreground shadow-elegant">
      {text}
    </div>
  );
}

export function AssistantMessage({ text }: { text: string }) {
  return (
    <div className="max-w-[85%] self-start font-display text-2xl leading-snug tracking-tight text-foreground">
      {text}
    </div>
  );
}