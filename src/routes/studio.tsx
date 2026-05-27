import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useRef, useState, type ReactNode } from "react";
import symbolLogo from "@/assets/symbol.svg";
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
  GripVertical,
  Plus,
  ImagePlus,
  Wand2,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  FolderOpen,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
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
  AssistantMessage,
  extractCardTitle,
  extractCardProse,
  extractProjectPatch,
  type CardAnswer,
} from "@/components/studio/generative-card";
import {
  INITIAL_PROJECT,
  applyPatch,
  type Character,
  type Music,
  type ProjectAsset,
  type ProjectPatch,
  type ProjectState,
  type Scene,
} from "@/lib/project-state";
export const Route = createFileRoute("/studio")({
  component: Studio,
});

// ---------- page ----------

function Studio() {
  const navigate = useNavigate();
  const [gate, setGate] = useState<"checking" | "ready">("checking");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/pika/status");
        const j = (await r.json()) as { state?: string };
        if (cancelled) return;
        if (j.state === "ready") setGate("ready");
        else void navigate({ to: "/" });
      } catch {
        if (!cancelled) void navigate({ to: "/" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const [project, setProject] = useState<ProjectState>(INITIAL_PROJECT);
  const [activeSceneId, setActiveSceneId] = useState<string>(
    INITIAL_PROJECT.scenes[0]?.id ?? "",
  );
  const [panelOpen, setPanelOpen] = useState(true);
  const { scenes, cast, music, meta, assets } = project;
  const totalDuration = scenes.reduce((a, s) => a + s.duration, 0);

  const handlePatch = (patch: ProjectPatch) => {
    setProject((prev) => applyPatch(prev, patch));
  };

  const setScenes = (next: Scene[]) =>
    setProject((prev) => ({ ...prev, scenes: next }));

  if (gate !== "ready") {
    return (
      <div className="grid h-screen w-full place-items-center bg-background text-sm text-muted-foreground">
        Checking Pika connection…
      </div>
    );
  }

  return (
    <div className="relative h-screen w-full overflow-hidden bg-background p-10 text-foreground">
      {/* Centered chat fills the screen; gallery & project panel float over it */}
      <div className="absolute inset-0 flex flex-col">
        <StudioTopBar
          meta={meta}
          duration={totalDuration}
          sceneCount={scenes.length}
          panelOpen={panelOpen}
          onTogglePanel={() => setPanelOpen((o) => !o)}
        />
        <div className="min-h-0 flex-1">
          <ChatPanel onPatch={handlePatch} assets={assets} />
        </div>
      </div>

      <FloatingGallery projectTitle={meta.title} />

      <aside
        className={`pointer-events-auto absolute right-4 top-4 bottom-4 z-30 overflow-hidden rounded-3xl bg-card shadow-elegant transition-[width,opacity] duration-300 ease-out ${
          panelOpen ? "w-[440px] opacity-100" : "w-0 opacity-0"
        }`}
      >
        <div className="h-full w-[440px]">
          <StructurePanel
            meta={meta}
            scenes={scenes}
            setScenes={setScenes}
            cast={cast}
            music={music}
            assets={assets}
            activeSceneId={activeSceneId}
            onSelect={setActiveSceneId}
            totalDuration={totalDuration}
          />
        </div>
      </aside>

      {!panelOpen && (
        <button
          onClick={() => setPanelOpen(true)}
          className="absolute right-4 top-1/2 z-30 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-card text-muted-foreground shadow-elegant transition hover:text-foreground"
          aria-label="Open project panel"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// ---------- gallery rail (left, projects) ----------

function FloatingGallery({ projectTitle }: { projectTitle: string }) {
  const [open, setOpen] = useState(false);
  return (
    <aside
      onClick={() => {
        if (!open) setOpen(true);
      }}
      className={`pointer-events-auto absolute left-4 top-4 z-30 flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-3xl bg-card shadow-elegant backdrop-blur-xl transition-all duration-300 ${
        open ? "w-72 cursor-default" : "w-16 cursor-pointer hover:shadow-glow"
      }`}
    >
      <div className="flex h-14 shrink-0 items-center justify-between px-3">
        <div className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground">
          <FolderOpen className="h-4 w-4" />
        </div>
        {open && (
          <span className="font-display text-base tracking-tight">Projects</span>
        )}
        {open && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Collapse projects"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {open ? (
          <div className="flex flex-col gap-2">
            <button
              className="flex items-center gap-3 rounded-2xl bg-muted/70 p-2 text-left"
            >
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-brand-gradient text-primary-foreground">
                <Film className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{projectTitle}</div>
                <div className="truncate text-xs text-muted-foreground">Current project</div>
              </div>
            </button>
            <button
              onClick={(e) => e.stopPropagation()}
              className="mt-1 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-3 text-sm font-semibold text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              <Plus className="h-4 w-4" /> New project
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div
              title={projectTitle}
              className="grid h-12 w-12 place-items-center rounded-xl bg-brand-gradient text-primary-foreground"
            >
              <Film className="h-4 w-4" />
            </div>
            <div className="mt-1 grid h-12 w-12 place-items-center rounded-xl border border-dashed border-border text-muted-foreground">
              <Plus className="h-4 w-4" />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

// ---------- top bar ----------

function StudioTopBar({
  meta,
  duration,
  sceneCount,
  panelOpen,
  onTogglePanel,
}: {
  meta: { title: string; format: string; aspectRatio: string };
  duration: number;
  sceneCount: number;
  panelOpen: boolean;
  onTogglePanel: () => void;
}) {
  return (
    <header className="pointer-events-none relative z-20 flex shrink-0 justify-center px-4 py-3">
      <Link
        to="/studio"
        className="pointer-events-auto absolute left-80 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Back home"
      >
        <ChevronLeft className="h-4 w-4" />
      </Link>
      <div className="pointer-events-auto flex flex-col items-center gap-3">
        <img src={symbolLogo} alt="Symbol" className="h-[21px] w-auto brightness-0" />
        <div className="flex items-center gap-3.5 rounded-full bg-foreground px-6 py-2.5 shadow-elegant">
          <ReelableMark className="h-7 w-7" />
          <div className="flex items-baseline gap-2.5 leading-tight">
            <span className="text-base font-semibold tracking-tight text-background">{meta.title}</span>
            <span className="text-xs text-background/60">
              {meta.format} · {meta.aspectRatio} · {sceneCount} scenes · {formatDuration(duration)}
            </span>
          </div>
        </div>
      </div>
      <button
        onClick={onTogglePanel}
        className="pointer-events-auto absolute right-6 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={panelOpen ? "Collapse project panel" : "Open project panel"}
      >
        {panelOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>
    </header>
  );
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Deep-walk a Pika MCP tool result looking for video URLs. MCP responses
// usually arrive as { content: [{ type: "text", text: "..." }, ...] } and
// may also include structuredContent. We accept any http(s) URL with a
// video-ish extension or path hint.
function extractVideoAssets(out: unknown): ProjectAsset[] {
  const urls = new Set<string>();
  const visit = (v: unknown) => {
    if (!v) return;
    if (typeof v === "string") {
      const re = /https?:\/\/[^\s"'<>)]+/g;
      const matches = v.match(re);
      if (matches) {
        for (const u of matches) {
          if (/\.(mp4|mov|webm|m4v)(\?|$)/i.test(u) || /pika|video|cdn/i.test(u)) {
            if (/\.(mp4|mov|webm|m4v)(\?|$)/i.test(u)) urls.add(u);
          }
        }
      }
      return;
    }
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (typeof v === "object") {
      for (const val of Object.values(v as Record<string, unknown>)) visit(val);
    }
  };
  visit(out);
  let i = 0;
  return Array.from(urls).map((url) => ({
    id: `ast_pika_${Date.now().toString(36)}_${i++}`,
    kind: "video" as const,
    mime: /\.webm/i.test(url) ? "video/webm" : "video/mp4",
    name: url.split("/").pop()?.split("?")[0] || "pika-clip.mp4",
    url,
    label: "Pika clip",
  }));
}

// ---------- chat panel ----------

const STARTERS = [
  "Music video",
  "30-second product ad",
  "Short drama, 2 minutes",
  "TikTok hook — fashion",
];

function ChatPanel({
  onPatch,
  assets,
}: {
  onPatch: (patch: ProjectPatch) => void;
  assets: ProjectAsset[];
}) {
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

  // Card answers can also carry uploaded assets. Patch them into project
  // state immediately so the panel reflects the upload, then send a
  // human-readable summary to the model (with asset ids it can reference).
  const handleCardAnswer = async (answer: CardAnswer) => {
    if (answer.assets.length) {
      onPatch({ assetsAppend: answer.assets });
    }
    await handleSend(answer.summary);
  };

  const textOf = (m: UIMessage) =>
    m.parts
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("")
      .trim();

  // Walk message parts looking for tool results. Each AI SDK tool part has
  // type "tool-<name>" with { state, toolCallId, input, output }.
  type ToolPart = {
    type: string;
    state?: string;
    toolCallId?: string;
    output?: unknown;
    input?: unknown;
  };
  const toolPartsOf = (m: UIMessage): ToolPart[] =>
    (m.parts as unknown as ToolPart[]).filter((p) =>
      typeof p.type === "string" && p.type.startsWith("tool-"),
    );

  // Pending tool calls in the in-flight assistant message (for the shimmer).
  const pendingTools: string[] = [];
  const last = messages[messages.length - 1];
  if (last && last.role === "assistant" && busy) {
    for (const p of toolPartsOf(last)) {
      if (p.state !== "output-available" && p.state !== "output-error") {
        const name = p.type.replace(/^tool-/, "");
        pendingTools.push(name);
      }
    }
  }

  // Apply project patches embedded in any assistant message exactly once.
  const appliedPatchIds = useRef<Set<string>>(new Set());
  const appliedToolCallIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      // 1) Hidden script patches in the card HTML.
      if (!appliedPatchIds.current.has(m.id)) {
        const patch = extractProjectPatch(textOf(m));
        if (patch) {
          appliedPatchIds.current.add(m.id);
          onPatch(patch as ProjectPatch);
        }
      }
      // 2) Tool results: auto-attach generated/stock assets and apply
      //    commit_project_patch outputs.
      for (const p of toolPartsOf(m)) {
        if (p.state !== "output-available") continue;
        const callId = p.toolCallId ?? "";
        if (!callId || appliedToolCallIds.current.has(callId)) continue;
        appliedToolCallIds.current.add(callId);
        const out = p.output as
          | { error?: string; id?: string; url?: string; assets?: ProjectAsset[]; patch?: unknown }
          | undefined;
        if (!out || out.error) continue;
        if (p.type === "tool-generate_image" && out.id && out.url) {
          onPatch({ assetsAppend: [out as ProjectAsset] });
        } else if (p.type === "tool-search_stock_media" && Array.isArray(out.assets)) {
          onPatch({ assetsAppend: out.assets });
        } else if (p.type === "tool-commit_project_patch" && out.patch) {
          onPatch(out.patch as ProjectPatch);
        } else if (p.type.startsWith("tool-pika_")) {
          // Sweep Pika MCP tool outputs for video URLs and attach them.
          const videos = extractVideoAssets(out);
          if (videos.length) onPatch({ assetsAppend: videos });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // History items = everything that's "decided". The most recent assistant
  // card (if not yet answered) is the *active* card, rendered anchored
  // above the input — NOT inside the scroll history.
  const history: Array<
    | { kind: "user"; key: string; text: string }
    | { kind: "assistant"; key: string; text: string }
    | { kind: "pill"; key: string; title: string; answer: string }
  > = [];
  let activeCard: { key: string; html: string } | null = null;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "user") {
      const prev = messages[i - 1];
      if (!prev || prev.role === "user") {
        history.push({ kind: "user", key: m.id, text: textOf(m) });
      }
      continue;
    }
    const html = textOf(m);
    const next = messages[i + 1];
    if (next && next.role === "user") {
      const prose =
        extractCardProse(html) || extractCardTitle(html);
      if (prose) {
        history.push({ kind: "assistant", key: `a-${m.id}`, text: prose });
      }
      history.push({
        kind: "pill",
        key: m.id,
        title: extractCardTitle(html),
        answer: textOf(next),
      });
    } else {
      activeCard = { key: m.id, html };
    }
  }

  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, activeCard?.key, busy]);

  return (
    <div className="relative flex h-full flex-col">
      <Conversation className="flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl gap-5 px-8 py-12">
          <div className="flex flex-col items-start gap-6 pt-6">
            <ReelableMark className="h-12 w-12" />
            <AssistantMessage text="What are we making? Type one word below — I'll take it from there." />
          </div>
          {history.map((it) =>
            it.kind === "user" ? (
              <UserBubble key={it.key} text={it.text} assets={assets} />
            ) : it.kind === "assistant" ? (
              <AssistantMessage key={it.key} text={it.text} />
            ) : (
              <DecisionPill
                key={it.key}
                title={it.title}
                answer={it.answer}
                onRevise={() =>
                  handleSend(`Let's revise "${it.title}" — show me that card again.`)
                }
              />
            ),
          )}
          {activeCard && (
            <AssistantMessage
              key={`q-${activeCard.key}`}
              text={
                extractCardProse(activeCard.html) ||
                extractCardTitle(activeCard.html)
              }
            />
          )}
          {busy && (
            <Shimmer>
              {pendingTools.length
                ? pendingTools[0] === "generate_image"
                  ? "Generating an image…"
                  : pendingTools[0] === "search_stock_media"
                    ? "Searching references…"
                    : "Working…"
                : "Thinking…"}
            </Shimmer>
          )}
          {error && (
            <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-5 py-3 text-sm text-destructive">
              {error.message ?? "Something went wrong with the AI gateway."}
            </div>
          )}
          <div ref={bottomRef} className="h-4" />
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Anchored composer: active card stacks directly above the input */}
      <div className="bg-background/80 backdrop-blur">
        <div className="mx-auto w-full max-w-3xl px-8 pb-8 pt-6">
          {!busy && activeCard && (
            <div className="mb-4">
              <GenerativeCard
                key={activeCard.key}
                html={activeCard.html}
                onAnswer={handleCardAnswer}
                assets={assets}
              />
            </div>
          )}
          {!busy && !activeCard && history.length === 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSend(s)}
                  className="rounded-full border border-border bg-card px-5 py-2.5 text-base font-medium text-foreground transition hover:border-primary/50 hover:shadow-glow"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <PromptInput
            onSubmit={async (msg) => {
              await handleSend(msg.text ?? input);
            }}
          >
            <PromptInputTextarea
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type freely…"
              className="text-lg"
            />
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit status={status} disabled={busy && !input} />
            </PromptInputFooter>
          </PromptInput>
        </div>
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
        <div className="flex items-center gap-2 text-xs text-muted-foreground" />
        <div className="flex items-center gap-1" />
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl">
          {scenes.length === 0 ? (
            <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card/20 p-10 text-center">
              <LayoutGrid className="h-6 w-6 text-muted-foreground" />
              <div className="text-sm font-medium">No scenes yet</div>
              <div className="max-w-xs text-xs text-muted-foreground">
                As you chat with the director on the left, scenes will appear here.
              </div>
            </div>
          ) : (
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
          )}
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
          {scenes.length === 0 && (
            <div className="flex-1 rounded-md border border-dashed border-border/60 px-2 py-2 text-center text-[10px] text-muted-foreground/70">
              Timeline empty
            </div>
          )}
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
              {s.thumb && (
                <img
                  src={s.thumb}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover opacity-50 group-hover:opacity-70"
                />
              )}
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
      <div className="aspect-[9/16] overflow-hidden bg-muted">
        {scene.thumb ? (
          <img
            src={scene.thumb}
            alt={scene.title}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-muted-foreground/50">
            <Film className="h-6 w-6" />
          </div>
        )}
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
  meta,
  scenes,
  setScenes,
  cast,
  music,
  assets,
  activeSceneId,
  onSelect,
  totalDuration,
}: {
  meta: {
    title: string;
    format: string;
    aspectRatio: string;
    logline: string;
    targetDuration: string;
    fps: string;
    resolution: string;
  };
  scenes: Scene[];
  setScenes: (s: Scene[]) => void;
  cast: Character[];
  music: Music;
  assets: ProjectAsset[];
  activeSceneId: string;
  onSelect: (id: string) => void;
  totalDuration: number;
}) {
  return (
    <div className="relative flex h-full flex-col">
      <Tabs defaultValue="storyboard" className="flex h-full flex-col">
        <div className="px-8 pt-8">
          <h2 className="font-display text-3xl font-extrabold leading-tight tracking-tight text-foreground">
            {meta.title}
          </h2>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            {meta.logline ||
              "Your video's overview will appear here and evolve as you make decisions in the chat."}
          </p>
          <TechSpecs meta={meta} totalDuration={totalDuration} sceneCount={scenes.length} />
          {assets.length > 0 && <AssetsStrip assets={assets} />}
        </div>
        <div className="mt-6 border-b-2 border-border/40 px-6 pb-0">
          <TabsList className="h-auto w-full justify-between gap-2 rounded-none bg-transparent p-0">
            {[
              { v: "storyboard", icon: LayoutGrid, label: "Storyboard" },
              { v: "scenes", icon: Film, label: "Scenes" },
              { v: "cast", icon: Users, label: "Cast" },
              { v: "music", icon: Music2, label: "Audio" },
            ].map(({ v, icon: Icon, label }) => (
              <TabsTrigger
                key={v}
                value={v}
                className="-mb-[2px] shrink-0 gap-2 rounded-none border-b-4 border-transparent bg-transparent px-1 pb-4 text-base font-bold text-muted-foreground/50 shadow-none transition-all data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                <Icon className="h-4 w-4" /> {label}
              </TabsTrigger>
            ))}
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

        <TabsContent value="scenes" className="m-0 flex-1 overflow-y-auto px-8 pt-8 pb-40">
          <div className="space-y-5">
            {scenes.length === 0 && (
              <EmptyHint icon={<Film className="h-8 w-8" />} text="Scenes will appear as you build out the storyboard." />
            )}
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
            <button className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-card/30 py-5 text-base font-semibold text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground">
              <Plus className="h-5 w-5" /> Add scene
            </button>
          </div>
        </TabsContent>

        <TabsContent value="cast" className="m-0 flex-1 overflow-y-auto px-8 pt-8 pb-40">
          <div className="space-y-5">
            {cast.length === 0 && (
              <EmptyHint icon={<Users className="h-8 w-8" />} text="No cast yet — ask the director to suggest characters." />
            )}
            {cast.map((c) => (
              <div
                key={c.id}
                className="flex gap-5 rounded-2xl border border-border/60 bg-card/40 p-5"
              >
                {c.ref ? (
                  <img
                    src={c.ref}
                    alt={c.name}
                    className="h-20 w-20 shrink-0 rounded-2xl object-cover"
                  />
                ) : (
                  <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-muted text-muted-foreground/50">
                    <Users className="h-7 w-7" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-lg font-bold tracking-tight">{c.name}</div>
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                      {c.role}
                    </span>
                  </div>
                  <div className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                    {c.notes}
                  </div>
                </div>
              </div>
            ))}
            <button className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-card/30 py-5 text-base font-semibold text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground">
              <ImagePlus className="h-5 w-5" /> Add character / reference
            </button>
          </div>
        </TabsContent>

        <TabsContent value="music" className="m-0 flex-1 overflow-y-auto px-8 pt-8 pb-40">
          {!music ? (
            <EmptyHint icon={<Music2 className="h-8 w-8" />} text="No audio yet — describe the music, voiceover, or sound design you want." />
          ) : (
          <div className="rounded-3xl border border-border/60 bg-card/40 p-6">
            <div className="flex items-center gap-4">
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-brand-gradient shadow-glow">
                <Music2 className="h-7 w-7 text-primary-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-lg font-bold tracking-tight">{music.title || "Untitled track"}</div>
                <div className="truncate text-sm text-muted-foreground">
                  {music.artist || "—"}
                </div>
              </div>
              <Button variant="ghost" size="icon">
                <Play className="h-5 w-5" />
              </Button>
            </div>
            <div className="mt-6 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-2xl bg-muted/60 py-4">
                <div className="text-xl font-bold tracking-tight text-foreground">{music.bpm || "—"}</div>
                <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">BPM</div>
              </div>
              <div className="rounded-2xl bg-muted/60 py-4">
                <div className="text-xl font-bold tracking-tight text-foreground">{music.key || "—"}</div>
                <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Key</div>
              </div>
              <div className="rounded-2xl bg-muted/60 py-4">
                <div className="text-xl font-bold tracking-tight text-foreground">{music.duration ? formatDuration(music.duration) : "—"}</div>
                <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Length</div>
              </div>
            </div>
            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <span>Beat map</span>
                <span>cuts auto-align</span>
              </div>
              <div className="flex h-14 items-end gap-[2px]">
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
          )}
        </TabsContent>
      </Tabs>

      {/* Floating sticky action bar */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-6 pb-6 pt-12 bg-gradient-to-t from-background via-background/95 to-transparent">
        <div className="pointer-events-auto flex items-center gap-3 rounded-3xl border border-border/60 bg-card/90 p-3 shadow-elegant backdrop-blur-xl">
          <button className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-muted/60 py-4 text-base font-bold tracking-tight text-foreground transition hover:bg-muted">
            Share
          </button>
          <button className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-muted/60 py-4 text-base font-bold tracking-tight text-foreground transition hover:bg-muted">
            Export
          </button>
          <button className="flex flex-[1.4] items-center justify-center gap-2 rounded-2xl bg-brand-gradient py-4 text-base font-bold tracking-tight text-primary-foreground shadow-glow transition hover:opacity-95">
            Render
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyHint({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-5 rounded-3xl border-2 border-dashed border-border/70 bg-card/20 px-6 py-20 text-center">
      <div className="grid h-20 w-20 place-items-center rounded-3xl bg-muted/60 text-muted-foreground/60">
        {icon}
      </div>
      <div className="max-w-[260px] text-base font-medium leading-relaxed text-muted-foreground">{text}</div>
    </div>
  );
}

function AssetsStrip({ assets }: { assets: ProjectAsset[] }) {
  return (
    <div className="mt-5">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
        References
      </div>
      <div className="flex flex-wrap gap-2">
        {assets.map((a) => (
          <div
            key={a.id}
            className="group relative overflow-hidden rounded-xl border border-border/60 bg-muted/40"
            title={`${a.kind} · ${a.name}`}
          >
            {a.mime.startsWith("image/") ? (
              <img src={a.url} alt={a.name} className="h-16 w-16 object-cover" />
            ) : (
              <div className="grid h-16 w-16 place-items-center text-lg text-muted-foreground">
                {a.mime.startsWith("audio/") ? "♪" : a.mime.startsWith("video/") ? "▶" : "•"}
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/90 to-transparent px-1.5 pb-1 pt-3 text-[9px] font-semibold capitalize text-foreground">
              {a.kind}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TechSpecs({
  meta,
  totalDuration,
  sceneCount,
}: {
  meta: {
    aspectRatio: string;
    targetDuration: string;
    fps: string;
    resolution: string;
  };
  totalDuration: number;
  sceneCount: number;
}) {
  const clean = (v: string) => (v && v !== "—" ? v : "");
  const length =
    clean(meta.targetDuration) ||
    (totalDuration > 0 ? formatDuration(totalDuration) : "");
  const specs: { label: string; value: string }[] = [
    { label: "Aspect", value: clean(meta.aspectRatio) || "—" },
    { label: "Length", value: length || "—" },
    { label: "Scenes", value: sceneCount > 0 ? String(sceneCount) : "—" },
    { label: "FPS", value: clean(meta.fps) || "—" },
    { label: "Resolution", value: clean(meta.resolution) || "—" },
  ];
  return (
    <div className="mt-5 flex flex-wrap gap-2">
      {specs.map((s) => (
        <div
          key={s.label}
          className="flex items-baseline gap-1.5 rounded-full bg-muted/60 px-3 py-1.5"
        >
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
            {s.label}
          </span>
          <span className="text-xs font-semibold tracking-tight text-foreground">
            {s.value}
          </span>
        </div>
      ))}
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
      className={`group cursor-pointer rounded-2xl border bg-card/40 p-5 transition ${
        active ? "border-primary/60 shadow-glow" : "border-border/60 hover:border-foreground/30"
      }`}
    >
      <div className="flex gap-4">
        <GripVertical className="mt-2 h-4 w-4 shrink-0 text-muted-foreground/50" />
        {scene.thumb ? (
          <img
            src={scene.thumb}
            alt=""
            className="h-20 w-14 shrink-0 rounded-xl object-cover"
          />
        ) : (
          <div className="grid h-20 w-14 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground/50">
            <Film className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-semibold text-muted-foreground">#{scene.n}</span>
              <span className="truncate text-base font-bold tracking-tight">{scene.title}</span>
            </div>
            <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
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
              className="mt-3 w-full resize-none rounded-xl border border-border bg-background/60 p-3 text-sm text-foreground focus:border-primary/60 focus:outline-none"
            />
          ) : (
            <p
              onClick={(e) => {
                e.stopPropagation();
                setEditing(true);
              }}
              className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground hover:text-foreground"
            >
              {scene.prompt}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}