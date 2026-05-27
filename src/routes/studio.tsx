import { createFileRoute, Link } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useState } from "react";
import {
  Play,
  Pause,
  Download,
  Share2,
  Film,
  LayoutGrid,
  Users,
  Music2,
  Clock,
  MoreHorizontal,
  GripVertical,
  Plus,
  ImagePlus,
  Wand2,
  ChevronLeft,
  Maximize2,
} from "lucide-react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { ReelableMark } from "@/components/reelable-mark";
import { Button } from "@/components/ui/button";
import {
  GenerativeCard,
  DecisionPill,
  UserBubble,
  extractCardTitle,
} from "@/components/studio/generative-card";
import sample1 from "@/assets/sample-1.jpg";
import sample2 from "@/assets/sample-2.jpg";
import sample3 from "@/assets/sample-3.jpg";
import sample4 from "@/assets/sample-4.jpg";

export const Route = createFileRoute("/studio")({
  component: Studio,
});

// ---------- sample structure data (would be persisted per-project) ----------

type Scene = {
  id: string;
  n: number;
  title: string;
  prompt: string;
  duration: number; // seconds
  thumb: string;
  status: "ready" | "drafting" | "rendering";
};

const INITIAL_SCENES: Scene[] = [
  { id: "s1", n: 1, title: "Cold open — neon street", prompt: "Wide shot, rain-soaked Tokyo alley at midnight. Neon signs flicker. A lone figure walks toward camera, silhouette only.", duration: 6, thumb: sample1, status: "ready" },
  { id: "s2", n: 2, title: "Close-up — the helmet", prompt: "Extreme close-up on a chrome motorcycle helmet, reflections of neon glide across the visor.", duration: 4, thumb: sample3, status: "ready" },
  { id: "s3", n: 3, title: "Drift sequence", prompt: "Tracking shot, bike drifting around a wet corner, sparks. Slow motion, 60fps.", duration: 8, thumb: sample2, status: "rendering" },
  { id: "s4", n: 4, title: "Skyline reveal", prompt: "Drone pull-back revealing the futuristic skyline. Camera rises through clouds.", duration: 6, thumb: sample4, status: "drafting" },
  { id: "s5", n: 5, title: "Logo card", prompt: "Brand logo materializes from particles on black background. Subtle hum.", duration: 3, thumb: sample1, status: "drafting" },
];

const CHARACTERS = [
  { id: "c1", name: "The Rider", role: "Protagonist", ref: sample3, notes: "Mid-20s, androgynous, chrome helmet, charcoal racing suit." },
  { id: "c2", name: "The Voice", role: "Narrator (VO)", ref: sample2, notes: "Low warm female voice, intimate, slight reverb." },
];

const MUSIC = {
  title: "Midnight Drift",
  artist: "Generated · synthwave",
  bpm: 96,
  key: "F# minor",
  beats: [0.0, 2.5, 5.0, 7.5, 10.0, 12.5, 15.0, 17.5, 20.0, 22.5, 25.0],
  duration: 27,
};

// ---------- page ----------

function Studio() {
  const [scenes, setScenes] = useState<Scene[]>(INITIAL_SCENES);
  const [activeSceneId, setActiveSceneId] = useState<string>(scenes[0].id);
  const totalDuration = scenes.reduce((a, s) => a + s.duration, 0);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <StudioTopBar duration={totalDuration} sceneCount={scenes.length} />
      <div className="flex-1 overflow-hidden border-t border-border/60">
        <ResizablePanelGroup orientation="horizontal" className="h-full">
          <ResizablePanel defaultSize={42} minSize={28} className="bg-sidebar/40">
            <ChatPanel />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={58} minSize={40}>
            <StructurePanel
              scenes={scenes}
              setScenes={setScenes}
              activeSceneId={activeSceneId}
              onSelect={setActiveSceneId}
              totalDuration={totalDuration}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

// ---------- top bar ----------

function StudioTopBar({ duration, sceneCount }: { duration: number; sceneCount: number }) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 px-4">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <ReelableMark className="h-7 w-7" />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-medium">Neon Drift</span>
          <span className="text-[11px] text-muted-foreground">
            Music video · 9:16 · {sceneCount} scenes · {formatDuration(duration)}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="gap-1.5">
          <Share2 className="h-3.5 w-3.5" /> Share
        </Button>
        <Button variant="ghost" size="sm" className="gap-1.5">
          <Download className="h-3.5 w-3.5" /> Export
        </Button>
        <button className="ml-1 inline-flex items-center gap-2 rounded-full bg-brand-gradient px-4 py-1.5 text-sm font-medium text-primary-foreground shadow-glow transition hover:opacity-95">
          <Wand2 className="h-3.5 w-3.5" /> Render
        </button>
      </div>
    </header>
  );
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ---------- chat panel ----------

const STARTERS = [
  "Music video",
  "30-second product ad",
  "Short drama, 2 minutes",
  "TikTok hook — fashion",
];

function ChatPanel() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const busy = status === "submitted" || status === "streaming";

  const handleSend = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    await sendMessage({ text: trimmed });
  };

  // Pair assistant cards with the user message that answered them.
  // Render the last assistant card as interactive; older ones collapse to pills.
  const textOf = (m: UIMessage) =>
    m.parts
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("")
      .trim();

  const items: Array<
    | { kind: "user"; key: string; text: string }
    | { kind: "pill"; key: string; title: string; answer: string }
    | { kind: "card"; key: string; html: string }
  > = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "user") {
      const prev = messages[i - 1];
      if (!prev || prev.role === "user") {
        items.push({ kind: "user", key: m.id, text: textOf(m) });
      }
      continue;
    }
    const html = textOf(m);
    const next = messages[i + 1];
    if (next && next.role === "user") {
      items.push({
        kind: "pill",
        key: m.id,
        title: extractCardTitle(html),
        answer: textOf(next),
      });
    } else {
      items.push({ kind: "card", key: m.id, html });
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Director</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            AI · live
          </span>
        </div>
        <Button variant="ghost" size="icon-sm">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </div>

      <Conversation className="flex-1">
        <ConversationContent className="gap-6 px-6 py-8">
          {messages.length === 0 ? (
            <ConversationEmptyState
              className="gap-6 px-4 py-12"
              icon={<ReelableMark className="h-14 w-14" />}
              title={
                <span className="font-display text-3xl tracking-tight">
                  What are we making?
                </span>
              }
              description="Type one word. I'll do the rest."
            >
              <div className="mt-6 flex w-full flex-col gap-2.5">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleSend(s)}
                    className="rounded-2xl border border-border bg-card px-5 py-4 text-left text-base font-medium text-foreground shadow-elegant transition hover:border-primary/50 hover:shadow-glow"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </ConversationEmptyState>
          ) : (
            items.map((it) => {
              if (it.kind === "user") {
                return <UserBubble key={it.key} text={it.text} />;
              }
              if (it.kind === "pill") {
                return (
                  <DecisionPill key={it.key} title={it.title} answer={it.answer} />
                );
              }
              // active card — hide while streaming, show shimmer instead
              if (status === "streaming") {
                return (
                  <Message key={it.key} from="assistant">
                    <Shimmer>Designing the next step…</Shimmer>
                  </Message>
                );
              }
              return (
                <GenerativeCard
                  key={it.key}
                  html={it.html}
                  onAnswer={handleSend}
                />
              );
            })
          )}
          {status === "submitted" && (
            <Message from="assistant">
              <Shimmer>Designing the next step…</Shimmer>
            </Message>
          )}
          {error && (
            <div className="mx-2 mt-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error.message ?? "Something went wrong with the AI gateway."}
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t border-border/60 p-3">
        <PromptInput
          onSubmit={async (msg) => {
            await handleSend(msg.text ?? input);
          }}
        >
          <PromptInputTextarea
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type freely, or just click the card above…"
          />
          <PromptInputFooter className="justify-end">
            <PromptInputSubmit status={status} disabled={busy && !input} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}

// ---------- preview panel (storyboard grid) ----------

function PreviewPanel({
  scenes,
  activeSceneId,
  onSelect,
  totalDuration,
}: {
  scenes: Scene[];
  activeSceneId: string;
  onSelect: (id: string) => void;
  totalDuration: number;
}) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
            Storyboard
          </span>
          <span>·</span>
          <span>Iteration 4</span>
          <span className="text-muted-foreground/60">· auto-saved</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => setPlaying((p) => !p)}>
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon-sm">
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {scenes.map((s) => (
              <SceneTile
                key={s.id}
                scene={s}
                active={s.id === activeSceneId}
                onClick={() => onSelect(s.id)}
              />
            ))}
            <button className="grid aspect-[9/16] place-items-center rounded-xl border border-dashed border-border bg-card/30 text-muted-foreground transition hover:border-primary/50 hover:text-foreground">
              <div className="flex flex-col items-center gap-1">
                <Plus className="h-5 w-5" />
                <span className="text-xs">New scene</span>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* timeline strip */}
      <div className="border-t border-border/60 bg-sidebar/60 px-4 py-3">
        <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>00:00</span>
          <span>Timeline</span>
          <span>{formatDuration(totalDuration)}</span>
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {scenes.map((s) => (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              style={{ flex: s.duration }}
              className={`group relative h-10 min-w-[60px] overflow-hidden rounded-md border transition ${
                s.id === activeSceneId
                  ? "border-primary/70 shadow-glow"
                  : "border-border hover:border-primary/40"
              }`}
            >
              <img
                src={s.thumb}
                alt=""
                className="absolute inset-0 h-full w-full object-cover opacity-50 group-hover:opacity-70"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background/90 to-transparent" />
              <div className="absolute bottom-0.5 left-1 text-[10px] font-medium">
                #{s.n}
              </div>
              <div className="absolute right-1 top-0.5 text-[10px] text-muted-foreground">
                {s.duration}s
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SceneTile({
  scene,
  active,
  onClick,
}: {
  scene: Scene;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group relative overflow-hidden rounded-xl border bg-card text-left shadow-elegant transition ${
        active
          ? "border-primary/70 ring-2 ring-primary/40 shadow-glow"
          : "border-border hover:border-primary/40"
      }`}
    >
      <div className="aspect-[9/16] overflow-hidden">
        <img
          src={scene.thumb}
          alt={scene.title}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
        />
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-background/95 via-background/20 to-transparent" />
      <div className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-background/70 px-2 py-0.5 text-[10px] backdrop-blur">
        #{scene.n}
      </div>
      <div className="absolute right-2 top-2">
        <StatusDot status={scene.status} />
      </div>
      <div className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-brand-gradient opacity-0 shadow-glow transition group-hover:opacity-100">
        <Play className="h-4 w-4 fill-primary-foreground text-primary-foreground" />
      </div>
      <div className="absolute bottom-0 left-0 right-0 p-2.5">
        <div className="text-xs font-medium leading-tight">{scene.title}</div>
        <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {scene.duration}s
        </div>
      </div>
    </button>
  );
}

function StatusDot({ status }: { status: Scene["status"] }) {
  const color =
    status === "ready"
      ? "bg-emerald-400"
      : status === "rendering"
        ? "bg-amber-400 animate-pulse"
        : "bg-muted-foreground/60";
  const label = status === "ready" ? "Ready" : status === "rendering" ? "Rendering" : "Draft";
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-background/70 px-1.5 py-0.5 text-[10px] backdrop-blur">
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}

// ---------- structure panel ----------

function StructurePanel({
  scenes,
  setScenes,
  activeSceneId,
  onSelect,
  totalDuration,
}: {
  scenes: Scene[];
  setScenes: (s: Scene[]) => void;
  activeSceneId: string;
  onSelect: (id: string) => void;
  totalDuration: number;
}) {
  return (
    <div className="flex h-full flex-col">
      <Tabs defaultValue="storyboard" className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Project
          </span>
          <TabsList className="h-7 bg-muted/60">
            <TabsTrigger value="storyboard" className="h-6 gap-1 px-2 text-xs">
              <LayoutGrid className="h-3 w-3" /> Storyboard
            </TabsTrigger>
            <TabsTrigger value="scenes" className="h-6 gap-1 px-2 text-xs">
              <Film className="h-3 w-3" /> Scenes
            </TabsTrigger>
            <TabsTrigger value="cast" className="h-6 gap-1 px-2 text-xs">
              <Users className="h-3 w-3" /> Cast
            </TabsTrigger>
            <TabsTrigger value="music" className="h-6 gap-1 px-2 text-xs">
              <Music2 className="h-3 w-3" /> Music
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="storyboard" className="m-0 flex-1 overflow-hidden">
          <PreviewPanel
            scenes={scenes}
            activeSceneId={activeSceneId}
            onSelect={onSelect}
            totalDuration={totalDuration}
          />
        </TabsContent>

        <TabsContent value="scenes" className="m-0 flex-1 overflow-y-auto p-3">
          <div className="space-y-2">
            {scenes.map((s) => (
              <SceneRow
                key={s.id}
                scene={s}
                active={s.id === activeSceneId}
                onClick={() => onSelect(s.id)}
                onChange={(next) =>
                  setScenes(scenes.map((x) => (x.id === next.id ? next : x)))
                }
              />
            ))}
            <button className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-card/30 py-2 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground">
              <Plus className="h-3.5 w-3.5" /> Add scene
            </button>
          </div>
        </TabsContent>

        <TabsContent value="cast" className="m-0 flex-1 overflow-y-auto p-3">
          <div className="space-y-2">
            {CHARACTERS.map((c) => (
              <div
                key={c.id}
                className="flex gap-3 rounded-lg border border-border bg-card/40 p-2.5"
              >
                <img
                  src={c.ref}
                  alt={c.name}
                  className="h-16 w-16 shrink-0 rounded-md object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">{c.name}</div>
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {c.role}
                    </span>
                  </div>
                  <div className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">
                    {c.notes}
                  </div>
                </div>
              </div>
            ))}
            <button className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-card/30 py-2 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground">
              <ImagePlus className="h-3.5 w-3.5" /> Add character / reference
            </button>
          </div>
        </TabsContent>

        <TabsContent value="music" className="m-0 flex-1 overflow-y-auto p-3">
          <div className="rounded-xl border border-border bg-card/40 p-3">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-lg bg-brand-gradient shadow-glow">
                <Music2 className="h-5 w-5 text-primary-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{MUSIC.title}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {MUSIC.artist}
                </div>
              </div>
              <Button variant="ghost" size="icon-sm">
                <Play className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
              <div className="rounded-md bg-muted/60 py-1.5">
                <div className="text-foreground">{MUSIC.bpm}</div>
                <div className="text-muted-foreground">BPM</div>
              </div>
              <div className="rounded-md bg-muted/60 py-1.5">
                <div className="text-foreground">{MUSIC.key}</div>
                <div className="text-muted-foreground">Key</div>
              </div>
              <div className="rounded-md bg-muted/60 py-1.5">
                <div className="text-foreground">{formatDuration(MUSIC.duration)}</div>
                <div className="text-muted-foreground">Length</div>
              </div>
            </div>
            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>Beat map</span>
                <span>cuts auto-align</span>
              </div>
              <div className="flex h-10 items-end gap-[2px]">
                {Array.from({ length: 60 }).map((_, i) => {
                  const h = 20 + Math.abs(Math.sin(i * 0.7)) * 70 + (i % 4 === 0 ? 10 : 0);
                  return (
                    <div
                      key={i}
                      style={{ height: `${h}%` }}
                      className={`w-full rounded-sm ${
                        i % 4 === 0 ? "bg-primary" : "bg-muted-foreground/40"
                      }`}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-border bg-card/40 p-3 text-xs text-muted-foreground">
            <div className="mb-1 font-medium text-foreground">Sound design</div>
            Synthwave pad, sub bass drop on scene 3 drift, neon hum bed throughout.
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SceneRow({
  scene,
  active,
  onClick,
  onChange,
}: {
  scene: Scene;
  active: boolean;
  onClick: () => void;
  onChange: (s: Scene) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div
      onClick={onClick}
      className={`group cursor-pointer rounded-lg border bg-card/40 p-2.5 transition ${
        active ? "border-primary/60 shadow-glow" : "border-border hover:border-primary/40"
      }`}
    >
      <div className="flex gap-2.5">
        <GripVertical className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        <img
          src={scene.thumb}
          alt=""
          className="h-14 w-10 shrink-0 rounded object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[10px] text-muted-foreground">#{scene.n}</span>
              <span className="truncate text-xs font-medium">{scene.title}</span>
            </div>
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {scene.duration}s
            </span>
          </div>
          {editing ? (
            <textarea
              autoFocus
              defaultValue={scene.prompt}
              onBlur={(e) => {
                onChange({ ...scene, prompt: e.target.value });
                setEditing(false);
              }}
              rows={3}
              className="mt-1.5 w-full resize-none rounded border border-border bg-background/60 p-1.5 text-[11px] text-foreground focus:border-primary/60 focus:outline-none"
            />
          ) : (
            <p
              onClick={(e) => {
                e.stopPropagation();
                setEditing(true);
              }}
              className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground hover:text-foreground"
            >
              {scene.prompt}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}