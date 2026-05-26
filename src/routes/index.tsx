import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowUp,
  Paperclip,
  Wand2,
  Film,
  Music2,
  Megaphone,
  Clapperboard,
  Play,
  Sparkles,
  Image as ImageIcon,
  Mic2,
  Clock,
} from "lucide-react";
import heroBg from "@/assets/hero-bg.jpg";
import sample1 from "@/assets/sample-1.jpg";
import sample2 from "@/assets/sample-2.jpg";
import sample3 from "@/assets/sample-3.jpg";
import sample4 from "@/assets/sample-4.jpg";

export const Route = createFileRoute("/")({
  component: Index,
});

const MODES = [
  { id: "short", label: "Short", icon: Film, hint: "Up to 60s • 9:16" },
  { id: "long", label: "Long-form", icon: Clapperboard, hint: "Up to 10 min" },
  { id: "ad", label: "Ad", icon: Megaphone, hint: "Product spots" },
  { id: "music", label: "Music video", icon: Music2, hint: "Lyric synced" },
  { id: "drama", label: "Drama", icon: Sparkles, hint: "Scene by scene" },
];

const PROMPTS = [
  "A 30-second TikTok ad for a minimalist Tokyo coffee shop, neon night vibe",
  "Music video: synthwave track, lone driver on a desert highway at dusk",
  "Short drama scene: two strangers meet on a rainy Lisbon tram",
  "2-minute brand film for a sustainable sneaker, slow-mo product shots",
];

const GALLERY = [
  { src: sample1, title: "Neon Drift", tag: "Short • 0:42", duration: "0:42" },
  { src: sample2, title: "Echoes Live", tag: "Music Video • 3:18", duration: "3:18" },
  { src: sample3, title: "Air Step 02", tag: "Ad • 0:30", duration: "0:30" },
  { src: sample4, title: "The Window", tag: "Drama • 7:12", duration: "7:12" },
];

function Index() {
  const [mode, setMode] = useState("short");
  const [prompt, setPrompt] = useState("");

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <img
          src={heroBg}
          alt=""
          className="h-[80vh] w-full object-cover opacity-60"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/60 to-background" />
      </div>

      {/* Nav */}
      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <a href="/" className="flex items-center gap-2">
          <span className="relative grid h-8 w-8 place-items-center rounded-lg bg-brand-gradient shadow-glow">
            <Play className="h-4 w-4 fill-primary-foreground text-primary-foreground" />
          </span>
          <span className="text-lg font-semibold tracking-tight">Reelable</span>
        </a>
        <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
          <a href="#showcase" className="hover:text-foreground">Showcase</a>
          <a href="#features" className="hover:text-foreground">Features</a>
          <a href="#pricing" className="hover:text-foreground">Pricing</a>
          <a href="#docs" className="hover:text-foreground">Docs</a>
        </nav>
        <div className="flex items-center gap-3">
          <button className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline">Sign in</button>
          <button className="rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow transition hover:opacity-90">
            Start creating
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 pt-16 pb-12 text-center sm:pt-24">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Now generating videos up to 10 minutes
        </div>
        <h1 className="mt-6 text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-7xl">
          Make a <span className="text-gradient">video</span>
          <br /> from a single sentence.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-pretty text-base text-muted-foreground sm:text-lg">
          Shorts, ads, music videos, dramas. Describe it, direct it, ship it — without leaving the browser.
        </p>

        {/* Prompt composer */}
        <div className="mx-auto mt-10 max-w-3xl">
          <div className="group relative rounded-2xl border border-border bg-card/60 p-2 shadow-elegant backdrop-blur-xl transition focus-within:border-primary/60 focus-within:shadow-glow">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A cinematic 45-second teaser for a sci-fi indie film, set on Mars..."
              rows={3}
              className="w-full resize-none rounded-xl bg-transparent px-4 py-3 text-left text-base placeholder:text-muted-foreground/70 focus:outline-none"
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-1">
              <div className="flex items-center gap-1 text-muted-foreground">
                <button className="rounded-lg p-2 hover:bg-muted hover:text-foreground" title="Attach reference">
                  <Paperclip className="h-4 w-4" />
                </button>
                <button className="rounded-lg p-2 hover:bg-muted hover:text-foreground" title="Image to video">
                  <ImageIcon className="h-4 w-4" />
                </button>
                <button className="rounded-lg p-2 hover:bg-muted hover:text-foreground" title="Voice over">
                  <Mic2 className="h-4 w-4" />
                </button>
                <span className="mx-2 hidden h-5 w-px bg-border sm:block" />
                <button className="hidden items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs hover:bg-muted hover:text-foreground sm:flex">
                  <Clock className="h-3.5 w-3.5" /> 30s
                </button>
                <button className="hidden items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs hover:bg-muted hover:text-foreground sm:flex">
                  9:16
                </button>
              </div>
              <button className="group/btn inline-flex items-center gap-2 rounded-xl bg-brand-gradient px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow transition hover:opacity-95">
                <Wand2 className="h-4 w-4" />
                Generate
                <ArrowUp className="h-4 w-4 transition group-hover/btn:-translate-y-0.5" />
              </button>
            </div>
          </div>

          {/* Mode chips */}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {MODES.map((m) => {
              const Icon = m.icon;
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setMode(m.id)}
                  className={`group inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition ${
                    active
                      ? "border-primary/60 bg-primary/10 text-foreground shadow-glow"
                      : "border-border bg-card/40 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {m.label}
                  <span className="hidden text-[11px] text-muted-foreground sm:inline">· {m.hint}</span>
                </button>
              );
            })}
          </div>

          {/* Suggested prompts */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => setPrompt(p)}
                className="max-w-xs truncate rounded-full border border-border bg-card/40 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                title={p}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Showcase */}
      <section id="showcase" className="relative z-10 mx-auto max-w-7xl px-6 py-24">
        <div className="mb-10 flex items-end justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">From the Reel</h2>
            <p className="mt-2 text-sm text-muted-foreground">A glimpse of what creators are shipping this week.</p>
          </div>
          <a href="#" className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline">Explore all →</a>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
          {GALLERY.map((g) => (
            <figure
              key={g.title}
              className="group relative overflow-hidden rounded-2xl border border-border bg-card shadow-elegant"
            >
              <div className="aspect-[3/4] overflow-hidden">
                <img
                  src={g.src}
                  alt={g.title}
                  loading="lazy"
                  className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
                />
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/10 to-transparent" />
              <div className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-background/60 px-2 py-0.5 text-[11px] text-foreground backdrop-blur">
                <Clock className="h-3 w-3" /> {g.duration}
              </div>
              <div className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-brand-gradient opacity-0 shadow-glow transition group-hover:opacity-100">
                <Play className="h-4 w-4 fill-primary-foreground text-primary-foreground" />
              </div>
              <figcaption className="absolute bottom-0 left-0 right-0 p-4">
                <div className="text-sm font-medium">{g.title}</div>
                <div className="text-xs text-muted-foreground">{g.tag}</div>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="relative z-10 mx-auto max-w-7xl px-6 pb-24">
        <div className="grid gap-4 sm:gap-6 md:grid-cols-3">
          {[
            {
              icon: Clapperboard,
              title: "Scene-by-scene director",
              body: "Storyboard your video like a script. Edit any shot with a prompt — the timeline keeps it cohesive.",
            },
            {
              icon: Music2,
              title: "Synced to sound",
              body: "Drop a track or generate one. Cuts, beats, and lip-sync land on the downbeat — automatically.",
            },
            {
              icon: Megaphone,
              title: "Export anywhere",
              body: "9:16, 1:1, 16:9. TikTok, Reels, YouTube, broadcast — one project, every aspect ratio.",
            },
          ].map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.title}
                className="group relative overflow-hidden rounded-2xl border border-border bg-card/60 p-6 backdrop-blur transition hover:border-primary/40"
              >
                <div className="absolute inset-0 -z-10 opacity-0 transition group-hover:opacity-100" style={{ background: "var(--gradient-surface)" }} />
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-gradient shadow-glow">
                  <Icon className="h-5 w-5 text-primary-foreground" />
                </div>
                <h3 className="text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 pb-32">
        <div className="relative overflow-hidden rounded-3xl border border-border bg-card/60 p-10 text-center backdrop-blur-xl">
          <div className="pointer-events-none absolute inset-0 -z-10 opacity-70" style={{ background: "var(--gradient-surface)" }} />
          <h3 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Your next <span className="text-gradient">scene</span> is one prompt away.
          </h3>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            Start free. Render up to 60 seconds. Upgrade when you're ready to ship the full feature.
          </p>
          <button className="mt-6 inline-flex items-center gap-2 rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-glow transition hover:opacity-95 animate-pulse-glow">
            <Wand2 className="h-4 w-4" /> Create your first reel
          </button>
        </div>
      </section>

      <footer className="relative z-10 border-t border-border/60 py-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-6 text-xs text-muted-foreground sm:flex-row">
          <div>© {new Date().getFullYear()} Reelable. All scenes reserved.</div>
          <div className="flex items-center gap-5">
            <a href="#" className="hover:text-foreground">Privacy</a>
            <a href="#" className="hover:text-foreground">Terms</a>
            <a href="#" className="hover:text-foreground">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
