import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { buildAuthHeaders } from "@/lib/fetch-with-auth";
import {
  getProject,
  updateProjectState,
  listProjects,
  createProject,
  updateProjectStudioPrefs,
} from "@/lib/projects.functions";
import { directGenerateStart, directGeneratePoll } from "@/lib/generate.functions";
import { StudioToolbar } from "@/components/studio/studio-toolbar";
import {
  DEFAULT_MODEL_BY_KIND,
  type StudioMode,
} from "@/lib/skills";
// "Shots" still routes through the chat AI (it asks the director to fill in
// any missing shot images via the generate_image tool).
// "Render final video" runs the deterministic fal.ai pipeline — no LLM.
import { renderFinalVideo, listProjectRenders } from "@/lib/render.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  Play,
  ListVideo,
  Pause,
  Download,
  Share2,
  Film,
  LayoutGrid,
  Users,
  Music2,
  Clock,
  Plus,
  ImagePlus,
  Wand2,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  FolderOpen,
  Loader2,
  History,
  RotateCw,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TimelinePanel } from "@/components/studio/timeline-panel";
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
import { BrandMark } from "@/components/pika-mark";
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
export const Route = createFileRoute("/_authenticated/studio/$projectId")({
  component: Studio,
});

// ---------- page ----------

function Studio() {
  const navigate = useNavigate();
  const { projectId } = Route.useParams();
  const fetchProject = useServerFn(getProject);
  const updateState = useServerFn(updateProjectState);
  const queryClient = useQueryClient();
  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => fetchProject({ data: { id: projectId } }),
    staleTime: Infinity,
  });

  const [project, setProject] = useState<ProjectState>(INITIAL_PROJECT);
  useEffect(() => {
    if (projectQuery.data?.project.projectState) {
      setProject(projectQuery.data.project.projectState);
    }
  }, [projectQuery.data?.project.id]);

  // Studio toolbar state: agent | image | video | audio | speech + selected
  // Fal model. Seeded from project columns; persisted server-side on change.
  const [studioMode, setStudioMode] = useState<StudioMode>("agent");
  const [studioModel, setStudioModel] = useState<string | null>(null);
  useEffect(() => {
    const p = projectQuery.data?.project;
    if (!p) return;
    const mode = (p.studioMode as StudioMode | undefined) || "agent";
    setStudioMode(mode);
    setStudioModel(p.studioModel ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectQuery.data?.project.id]);
  const persistPrefs = useServerFn(updateProjectStudioPrefs);
  const onToolbarChange = (next: { mode: StudioMode; model: string | null }) => {
    setStudioMode(next.mode);
    setStudioModel(next.model);
    void persistPrefs({
      data: {
        id: projectId,
        studioMode: next.mode,
        studioModel: next.model,
      },
    });
  };

  const initialMessages: UIMessage[] = (projectQuery.data?.messages ?? []).map(
    (m) => ({
      id: m.id,
      role: m.role,
      parts: (Array.isArray(m.parts) ? m.parts : []) as UIMessage["parts"],
    }),
  ) as UIMessage[];

  const [activeSceneId, setActiveSceneId] = useState<string>(
    INITIAL_PROJECT.scenes[0]?.id ?? "",
  );
  // Panel auto-shows whenever the project has something to display
  // (scenes, cast, music, or assets). User can still collapse/expand
  // manually; the manual preference resets whenever the content state
  // flips, so a freshly-populated project always reveals the panel.
  const [userPanelPref, setUserPanelPref] = useState<boolean | null>(null);
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 440;
    const saved = Number(window.localStorage.getItem("studio:panelWidth"));
    return Number.isFinite(saved) && saved >= 320 && saved <= 1200 ? saved : 440;
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("studio:panelWidth", String(panelWidth));
    }
  }, [panelWidth]);
  // During a drag we mutate refs + CSS variables directly so the whole
  // Studio tree (chat, structure panel, timeline) doesn't re-render on
  // every mousemove. State is only committed on mouseup.
  const chatShellRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const innerPanelRef = useRef<HTMLDivElement>(null);
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidth;
    let next = startW;
    let raf = 0;
    const apply = () => {
      raf = 0;
      if (chatShellRef.current) chatShellRef.current.style.paddingRight = `${next + 32}px`;
      if (asideRef.current) asideRef.current.style.width = `${next}px`;
      if (innerPanelRef.current) innerPanelRef.current.style.width = `${next}px`;
    };
    const onMove = (ev: MouseEvent) => {
      const maxW = Math.min(1200, window.innerWidth - 360);
      next = Math.max(320, Math.min(maxW, startW + (startX - ev.clientX)));
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (raf) cancelAnimationFrame(raf);
      // Commit final width once — triggers the single React re-render.
      setPanelWidth(next);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const { scenes, cast, music, meta, assets } = project;
  const hasPanelContent =
    scenes.length > 0 || cast.length > 0 || !!music || assets.length > 0;
  const panelOpen = hasPanelContent && (userPanelPref ?? true);
  useEffect(() => {
    // Reset manual override when content presence toggles.
    setUserPanelPref(null);
  }, [hasPanelContent]);
  const totalDuration = scenes.reduce((a, s) => a + s.duration, 0);

  // Subscribe to live project_state updates pushed by the render pipeline,
  // so shot thumbnails appear as images finish.
  useEffect(() => {
    if (!projectId) return;
    const channel = supabase
      .channel(`project-${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "projects",
          filter: `id=eq.${projectId}`,
        },
        (payload) => {
          const next = (payload.new as { project_state?: ProjectState })
            ?.project_state;
          if (next) setProject(next);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [projectId]);

  const handlePatch = (patch: ProjectPatch) => {
    setProject((prev) => applyPatch(prev, patch));
    // Optimistically bump this project to the top of the panel right away.
    queryClient.setQueryData<{ projects: Array<{ id: string; updatedAt: string }> }>(
      ["projects-list"],
      (old) => {
        if (!old?.projects) return old;
        const now = new Date().toISOString();
        const idx = old.projects.findIndex((p) => p.id === projectId);
        if (idx === -1) return old;
        const next = [...old.projects];
        const [hit] = next.splice(idx, 1);
        next.unshift({ ...hit, updatedAt: now });
        return { ...old, projects: next };
      },
    );
    void updateState({ data: { id: projectId, patch } }).then(() => {
      void queryClient.invalidateQueries({ queryKey: ["projects-list"] });
    });
  };

  // The Render / Production buttons live in the right-hand StructurePanel
  // but need to dispatch into the chat (which owns the AI SDK session).
  // We expose a ref the ChatPanel registers its sender into.
  const chatSendRef = useRef<((text: string) => void) | null>(null);

  const setScenes = (next: Scene[]) =>
    setProject((prev) => ({ ...prev, scenes: next }));

  if (projectQuery.isLoading) {
    return (
      <div className="grid h-screen w-full place-items-center bg-background text-sm text-muted-foreground">
        Loading project…
      </div>
    );
  }
  if (projectQuery.isError) {
    return (
      <div className="grid h-screen w-full place-items-center bg-background text-sm text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <div>Couldn't load this project.</div>
          <Link to="/projects" className="text-primary underline">
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-[calc(100vh-3.5rem)] w-full overflow-hidden bg-background p-10 text-foreground">
      {/* Centered chat fills the screen; gallery & project panel float over it */}
      <div
        ref={chatShellRef}
        className="absolute inset-0 flex flex-col"
        style={{ paddingRight: panelOpen ? panelWidth + 32 : 0 }}
      >
        <StudioTopBar
          meta={meta}
          duration={totalDuration}
          sceneCount={scenes.length}
          panelOpen={panelOpen}
          canTogglePanel={hasPanelContent}
          onTogglePanel={() => setUserPanelPref(!panelOpen)}
        />
        <div className="min-h-0 flex-1">
          <ChatPanel
            projectId={projectId}
            initialMessages={initialMessages}
            onPatch={handlePatch}
            assets={assets}
            studioMode={studioMode}
            projectMode={
              (projectQuery.data?.project.studioMode as StudioMode | undefined) ||
              "agent"
            }
            studioModel={studioModel}
            onToolbarChange={onToolbarChange}
            registerSender={(fn) => {
              chatSendRef.current = fn;
            }}
          />
        </div>
      </div>

      <FloatingGallery currentProjectId={projectId} currentTitle={meta.title} />

      <aside
        ref={asideRef}
        style={{ width: panelOpen ? panelWidth : 0 }}
        className={`pointer-events-auto absolute right-4 top-4 bottom-4 z-30 overflow-hidden rounded-3xl bg-card shadow-elegant ${
          panelOpen ? "opacity-100" : "opacity-0"
        }`}
      >
        {panelOpen && (
          <div
            onMouseDown={startResize}
            className="group absolute left-0 top-0 z-40 flex h-full w-2 cursor-col-resize items-center justify-center hover:bg-primary/10"
            aria-label="Resize panel"
            role="separator"
          >
            <div className="h-12 w-1 rounded-full bg-border transition group-hover:bg-primary" />
          </div>
        )}
        <div ref={innerPanelRef} className="h-full" style={{ width: panelWidth }}>
          <StructurePanel
            projectId={projectId}
            meta={meta}
            scenes={scenes}
            setScenes={setScenes}
            cast={cast}
            music={music}
            assets={assets}
            activeSceneId={activeSceneId}
            onSelect={setActiveSceneId}
            totalDuration={totalDuration}
            onChatCommand={(text) => chatSendRef.current?.(text)}
            studioMode={studioMode}
          />
        </div>
      </aside>

    </div>
  );
}

// ---------- gallery rail (left, projects) ----------

function FloatingGallery({
  currentProjectId,
  currentTitle,
}: {
  currentProjectId: string;
  currentTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const fetchList = useServerFn(listProjects);
  const createNew = useServerFn(createProject);
  const queryClient = useQueryClient();
  const listQuery = useQuery({
    queryKey: ["projects-list"],
    queryFn: () => fetchList(),
    // Always enabled so the collapsed circle strip stays in sync and the
    // active project bubbles to the top whenever its state is patched.
    refetchOnWindowFocus: true,
  });
  const onNew = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const { id } = await createNew({ data: {} });
    void queryClient.invalidateQueries({ queryKey: ["projects-list"] });
    void navigate({ to: "/studio/$projectId", params: { projectId: id } });
  };
  type ProjectRow = {
    id: string;
    title: string;
    status: string;
    updatedAt: string;
    createdAt: string;
    format: string;
    aspectRatio: string;
    sceneCount: number;
    thumbnailUrl: string | null;
  };
  const projects: ProjectRow[] = (listQuery.data?.projects ?? []) as ProjectRow[];
  const collapsedPreview = projects.slice(0, 6);
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

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-visible px-3 py-2 pb-4">
        {open ? (
          <div className="flex flex-col gap-2">
            {projects.length === 0 && listQuery.isLoading && (
              <div className="px-2 py-4 text-xs text-muted-foreground">Loading…</div>
            )}
            {projects.map((p) => {
              const isCurrent = p.id === currentProjectId;
              const label = isCurrent ? currentTitle : p.title;
              return (
                <button
                  key={p.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isCurrent)
                      void navigate({
                        to: "/studio/$projectId",
                        params: { projectId: p.id },
                      });
                  }}
                  className={`flex items-center gap-3 rounded-2xl p-2 text-left transition ${
                    isCurrent ? "bg-muted/70" : "opacity-60 hover:opacity-100 hover:bg-muted/40"
                  }`}
                >
                  <ProjectAvatar
                    title={p.title}
                    thumbnailUrl={p.thumbnailUrl}
                    isCurrent={isCurrent}
                    size={56}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{label}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {isCurrent ? "Current project" : `${p.sceneCount} shot${p.sceneCount === 1 ? "" : "s"}`}
                    </div>
                  </div>
                </button>
              );
            })}
            <button
              onClick={onNew}
              className="mt-1 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-3 text-sm font-semibold text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              <Plus className="h-4 w-4" /> New project
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            {collapsedPreview.length === 0 && (
              <ProjectAvatar
                title={currentTitle}
                thumbnailUrl={null}
                isCurrent
                size={48}
              />
            )}
            {collapsedPreview.map((p) => {
              const isCurrent = p.id === currentProjectId;
              return (
                <ProjectAvatar
                  key={p.id}
                  title={isCurrent ? currentTitle : p.title}
                  thumbnailUrl={p.thumbnailUrl}
                  isCurrent={isCurrent}
                  size={48}
                />
              );
            })}
            <div
              onClick={(e) => {
                e.stopPropagation();
                void onNew(e);
              }}
              className="mt-1 grid h-12 w-12 cursor-pointer place-items-center rounded-full border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
              title="New project"
            >
              <Plus className="h-4 w-4" />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function ProjectAvatar({
  title,
  thumbnailUrl,
  isCurrent,
  size,
}: {
  title: string;
  thumbnailUrl: string | null;
  isCurrent: boolean;
  size: number;
}) {
  const initial = (title || "?").trim().charAt(0).toUpperCase() || "?";
  const ring = isCurrent
    ? "ring-2 ring-primary opacity-100"
    : "ring-1 ring-border opacity-50 grayscale";
  return (
    <div
      style={{ width: size, height: size }}
      className={`relative shrink-0 overflow-hidden rounded-full bg-brand-gradient text-primary-foreground transition ${ring}`}
      title={title}
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt={title}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="grid h-full w-full place-items-center font-display text-base font-semibold">
          {initial}
        </div>
      )}
    </div>
  );
}

// ---------- top bar ----------

function StudioTopBar({
  meta,
  duration,
  sceneCount,
  panelOpen,
  canTogglePanel,
  onTogglePanel,
}: {
  meta: { title: string; format: string; aspectRatio: string };
  duration: number;
  sceneCount: number;
  panelOpen: boolean;
  canTogglePanel: boolean;
  onTogglePanel: () => void;
}) {
  return (
    <header className="pointer-events-none relative z-20 flex shrink-0 justify-center px-4 py-3">
      <div className="pointer-events-auto flex flex-col items-center gap-6 pt-6">
        <div className="flex items-center gap-3.5 rounded-full bg-foreground px-6 py-2.5 shadow-elegant">
            <BrandMark className="h-7 w-7" />
          <div className="flex items-baseline gap-2.5 leading-tight">
            <span className="text-base font-semibold tracking-tight text-background">{meta.title}</span>
            <span className="text-xs text-background/60">
              {meta.format} · {meta.aspectRatio} · {sceneCount} shots · {formatDuration(duration)}
            </span>
          </div>
        </div>
      </div>
      {canTogglePanel && (
        <button
          onClick={onTogglePanel}
          className="pointer-events-auto absolute right-6 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={panelOpen ? "Collapse project panel" : "Open project panel"}
        >
          {panelOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      )}
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

function ChatPanel({
  projectId,
  initialMessages,
  onPatch,
  assets,
  studioMode,
  projectMode,
  studioModel,
  onToolbarChange,
  registerSender,
}: {
  projectId: string;
  initialMessages: UIMessage[];
  onPatch: (patch: ProjectPatch) => void;
  assets: ProjectAsset[];
  studioMode: StudioMode;
  projectMode: StudioMode;
  studioModel: string | null;
  onToolbarChange: (next: { mode: StudioMode; model: string | null }) => void;
  registerSender?: (fn: (text: string) => void) => void;
}) {
  const [input, setInput] = useState("");
  const { messages, sendMessage, setMessages, status, error } = useChat({
    id: projectId,
    messages: initialMessages,
    generateId: () =>
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      headers: () => buildAuthHeaders(),
      body: () => ({ projectId }),
    }),
  });

  const runDirectStart = useServerFn(directGenerateStart);
  const runDirectPoll = useServerFn(directGeneratePoll);
  const [directBusy, setDirectBusy] = useState(false);
  const busy = status === "submitted" || status === "streaming" || directBusy;

  const handleSend = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    if (studioMode === "agent") {
      await sendMessage({ text: trimmed });
      return;
    }
    // Non-agent: skip the chat agent; call the matching Fal model directly.
    const model = studioModel ?? DEFAULT_MODEL_BY_KIND[studioMode];
    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", parts: [{ type: "text", text: trimmed }] } as UIMessage,
    ]);
    setDirectBusy(true);
    try {
      const started = await runDirectStart({
        data: {
          projectId,
          prompt: trimmed,
          mode: studioMode,
          model,
          userMessageId: userId,
          assistantMessageId: assistantId,
        },
      });
      if (!started.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: "assistant",
            parts: [{ type: "text", text: started.assistantText }],
          } as UIMessage,
        ]);
        return;
      }
      // Poll fal queue until done (or ~10 min cap).
      const deadline = Date.now() + 10 * 60_000;
      let finalText: string | null = null;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        const tick = await runDirectPoll({
          data: {
            projectId,
            mode: studioMode,
            model,
            prompt: trimmed,
            assistantMessageId: assistantId,
            statusUrl: started.statusUrl,
            responseUrl: started.responseUrl,
          },
        });
        if (tick.status === "done") {
          finalText = tick.assistantText ?? "Done.";
          break;
        }
      }
      if (!finalText) finalText = "Generation timed out — please try again.";
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          parts: [{ type: "text", text: finalText }],
        } as UIMessage,
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          parts: [{ type: "text", text: `Generation failed — ${msg}` }],
        } as UIMessage,
      ]);
    } finally {
      setDirectBusy(false);
    }
  };

  // Expose our sender to the parent so the right-hand panel buttons can
  // dispatch directives into the chat (keyframes / production).
  useEffect(() => {
    registerSender?.((text: string) => {
      void handleSend(text);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerSender, busy]);

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
          if (out.patch) onPatch(out.patch as ProjectPatch);
        } else if (p.type === "tool-search_stock_media" && Array.isArray(out.assets)) {
          onPatch({ assetsAppend: out.assets });
        } else if (p.type === "tool-commit_project_patch" && out.patch) {
          onPatch(out.patch as ProjectPatch);
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
      const hasMedia = !!(extractProjectPatch(html) as { assetsAppend?: unknown[] } | null)?.assetsAppend?.length;
      const prose = extractCardProse(html) || extractCardTitle(html);
      if (prose || hasMedia) {
        history.push({ kind: "assistant", key: `a-${m.id}`, text: html });
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
            <BrandMark className="h-12 w-12" />
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
                assets={assets}
                onRevise={() =>
                  handleSend(`Let's revise "${it.title}" — show me that card again.`)
                }
              />
            ),
          )}
          {activeCard && (() => {
            return (
              <AssistantMessage key={`q-${activeCard.key}`} text={activeCard.html} />
            );
          })()}
          {busy && (
            <Shimmer>
              {pendingTools.length
                ? pendingTools[0] === "generate_image"
                  ? "Generating an image…"
                  : pendingTools[0] === "search_stock_media"
                    ? "Searching references…"
                    : `Running ${pendingTools[0]}…`
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
                projectId={projectId}
              />
            </div>
          )}
          {!busy && !activeCard && history.length === 0 && projectMode === "agent" && (
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
          {!busy && studioMode !== "agent" && history.length > 0 && (
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Create another
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
              placeholder={
                studioMode === "agent"
                  ? "Type freely…"
                  : `Describe the ${studioMode} you want…`
              }
              className="text-lg"
            />
            <PromptInputFooter className="justify-between gap-2">
              <StudioToolbar
                mode={studioMode}
                model={studioModel}
                onChange={onToolbarChange}
              />
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
              <div className="text-sm font-medium">No shots yet</div>
              <div className="max-w-xs text-xs text-muted-foreground">
                As you chat with the director on the left, shots will appear here.
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
                <span className="text-xs">New shot</span>
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
  const isRendering = scene.status === "rendering";
  const hasClip = !!scene.clipUrl;
  return (
    <button
      onClick={onClick}
      className={`group relative overflow-hidden rounded-xl border bg-card text-left shadow-elegant transition ${
        active
          ? "border-primary/70 ring-2 ring-primary/40 shadow-glow"
          : "border-border hover:border-primary/40"
      }`}
    >
      <div className="relative aspect-[9/16] overflow-hidden bg-muted">
        {hasClip ? (
          <video
            src={scene.clipUrl}
            className="h-full w-full object-cover"
            muted
            loop
            playsInline
            preload="metadata"
            onMouseEnter={(e) => void (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
            onMouseLeave={(e) => (e.currentTarget as HTMLVideoElement).pause()}
            poster={scene.thumb || undefined}
          />
        ) : scene.thumb ? (
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
        {isRendering && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/40 backdrop-blur-sm">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-background/95 via-background/20 to-transparent" />
      <div className="absolute inset-x-2 top-2 flex items-start justify-between">
        <span className="inline-flex items-center gap-1 rounded-full bg-background/70 px-2 py-0.5 text-[10px] leading-none backdrop-blur">
          #{scene.n}
        </span>
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
    <span className="inline-flex items-start gap-1 rounded-full bg-background/70 px-1.5 py-0.5 text-[10px] leading-none backdrop-blur">
      <span className={`mt-[3px] h-1.5 w-1.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}

// ---------- structure panel ----------

function StructurePanel({
  projectId,
  meta,
  scenes,
  setScenes,
  cast,
  music,
  assets,
  activeSceneId,
  onSelect,
  totalDuration,
  onChatCommand,
  studioMode,
}: {
  projectId: string;
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
  onChatCommand?: (text: string) => void;
  studioMode: StudioMode;
}) {
  const [renderMsg, setRenderMsg] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderJobId, setRenderJobId] = useState<string | null>(null);
  const runFinal = useServerFn(renderFinalVideo);

  // While a render job is active: subscribe to its row and tick the
  // background pipeline every few seconds (belt-and-suspenders with the
  // pg_cron-driven server-side tick).
  useEffect(() => {
    if (!renderJobId) return;
    let cancelled = false;

    const ping = () => {
      void fetch("/api/public/render-tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => {});
    };
    ping();
    const interval = window.setInterval(ping, 6_000);

    const channel = supabase
      .channel(`render-job-${renderJobId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "render_jobs",
          filter: `id=eq.${renderJobId}`,
        },
        (payload) => {
          if (cancelled) return;
          const row = payload.new as { status?: string; error?: string | null };
          if (row.status === "done") {
            setRenderMsg(
              row.error
                ? `Final video ready — ${row.error}.`
                : "Final video ready.",
            );
            setRendering(false);
            setRenderJobId(null);
          } else if (row.status === "failed") {
            setRenderMsg(`Render failed: ${row.error ?? "unknown error"}`);
            setRendering(false);
            setRenderJobId(null);
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [renderJobId]);

  const missingShotImages = scenes.filter((s) => !s.thumb).length;
  const missingClips = scenes.filter((s) => !s.clipUrl).length;
  const onGenerateShotImages = () => {
    if (scenes.length === 0) {
      setRenderMsg("Draft at least one shot first — describe the concept in chat.");
      return;
    }
    const likenessAssetIds = Array.from(
      new Set([
        ...cast.map((c) => c.ref).filter(Boolean),
        ...assets.filter((a) => a.kind === "likeness").map((a) => a.id),
      ]),
    );
    setRenderMsg("Asked the director to generate shot images.");
    onChatCommand?.(
      `GENERATE SHOT IMAGES NOW for every shot that doesn't already have one. ` +
      `For each such shot, call the generate_image tool with a vivid, cinematic prompt that bakes in: ` +
      `(1) the project logline, (2) the shot title + shot prompt, (3) the cast notes & any uploaded ` +
      `likeness/reference assets, and (4) a consistent visual style across all shots. ` +
      `${likenessAssetIds.length ? `Use referenceAssetIds=${JSON.stringify(likenessAssetIds)} anywhere the user or cast should appear so their face is actually used in generation. ` : ""}` +
      `After each image returns, emit a commit_project_patch that updates scenes[i].thumb to the new ` +
      `asset URL (and sets status to "ready"). Do all shots in this turn. Final card: a short handoff ` +
      `confirming how many shot images were generated.`,
    );
  };
  const onRenderFinal = async () => {
    if (scenes.length === 0) {
      setRenderMsg("Draft at least one shot first.");
      return;
    }
    setRendering(true);
    setRenderMsg(
      `Rendering final video — generating any missing shot images, animating shots, scoring music, recording voiceover, then stitching. This can take several minutes.`,
    );
    try {
      const res = await runFinal({ data: { projectId } });
      // Kickoff returns immediately; a background tick pipeline (pg_cron +
      // client poll below) advances the job. We watch render_jobs via
      // Realtime to flip the message to done/failed.
      setRenderJobId(res.renderJobId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setRenderMsg(`Render failed: ${msg}`);
      setRendering(false);
    }
  };
  return (
    <div className="relative flex h-full flex-col">
      <Tabs
        defaultValue={studioMode === "agent" ? "shots" : "gallery"}
        className="flex h-full flex-col"
      >
        <div className="px-8 pt-8">
          <h2 className="font-display text-3xl font-extrabold leading-tight tracking-tight text-foreground">
            {meta.title}
          </h2>
          {studioMode === "agent" ? (
            <>
              <p className="mt-3 text-base leading-relaxed text-muted-foreground">
                {meta.logline ||
                  "Your video's overview will appear here and evolve as you make decisions in the chat."}
              </p>
              <TechSpecs meta={meta} totalDuration={totalDuration} sceneCount={scenes.length} />
              {assets.filter((a) => a.kind !== "keyframe").length > 0 && (
                <AssetsStrip assets={assets.filter((a) => a.kind !== "keyframe")} />
              )}
            </>
          ) : (
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">
              Every generation from this app collects here.
            </p>
          )}
        </div>
        <div className="mt-6 border-b-2 border-border/40 px-6 pb-0">
          <TabsList className="h-auto w-full justify-between gap-2 rounded-none bg-transparent p-0">
            {(studioMode === "agent"
              ? [
                  { v: "shots", icon: Film, label: "Shots" },
                  { v: "cast", icon: Users, label: "Cast" },
                  { v: "music", icon: Music2, label: "Audio" },
                  { v: "timeline", icon: ListVideo, label: "Timeline" },
                  { v: "renders", icon: History, label: "Renders" },
                ]
              : [
                  { v: "gallery", icon: LayoutGrid, label: "Gallery" },
                  { v: "renders", icon: History, label: "Renders" },
                ]
            ).map(({ v, icon: Icon, label }) => (
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

        {studioMode !== "agent" && (
          <TabsContent value="gallery" className="m-0 flex-1 overflow-y-auto px-8 pt-8 pb-40">
            <GalleryGrid assets={assets} />
          </TabsContent>
        )}

        <TabsContent value="shots" className="m-0 flex-1 overflow-y-auto px-8 pt-8 pb-40">
          <div className="space-y-5">
            {scenes.length === 0 && (
              <EmptyHint icon={<Film className="h-8 w-8" />} text="Shots will appear as you build out your video with the director." />
            )}
            {scenes.map((s) => (
              <SceneRow
                key={s.id}
                scene={s}
                active={s.id === activeSceneId}
                aspectRatio={meta.aspectRatio}
                onClick={() => onSelect(s.id)}
                onChange={(next) =>
                  setScenes(scenes.map((x) => (x.id === next.id ? next : x)))
                }
              />
            ))}
            <button className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-card/30 py-5 text-base font-semibold text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground">
              <Plus className="h-5 w-5" /> Add shot
            </button>
          </div>
        </TabsContent>


        <TabsContent value="cast" className="m-0 flex-1 overflow-y-auto px-8 pt-8 pb-40">
          <div className="space-y-5">
            {cast.length === 0 && (
              <EmptyHint icon={<Users className="h-8 w-8" />} text="No cast yet — ask the director to suggest characters." />
            )}
            {cast.map((c) => {
              // c.ref is an asset id (ast_xxx) — resolve it against the
              // project's assets list so the uploaded selfie/likeness shows.
              const refUrl =
                (c.ref && assets.find((a) => a.id === c.ref)?.url) ||
                (c.ref && /^https?:|^blob:|^\//.test(c.ref) ? c.ref : "");
              return (
              <div
                key={c.id}
                className="flex gap-5 rounded-2xl border border-border/60 bg-card/40 p-5"
              >
                {refUrl ? (
                  <img
                    src={refUrl}
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
              );
            })}
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

        <TabsContent value="timeline" className="m-0 flex-1 overflow-hidden">
          <TimelinePanel
            scenes={scenes}
            setScenes={setScenes}
            activeSceneId={activeSceneId}
            onSelect={onSelect}
            music={music}
            assets={assets}
          />
        </TabsContent>

        <TabsContent value="renders" className="m-0 flex-1 overflow-y-auto px-8 pt-8 pb-40">
          <RendersPanel
            projectId={projectId}
            activeJobId={renderJobId}
            onRetry={onRenderFinal}
            isRendering={rendering}
          />
        </TabsContent>
      </Tabs>

      {/* Floating sticky action bar */}
      {studioMode === "agent" && (
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-6 pb-6 pt-12 bg-gradient-to-t from-background via-background/95 to-transparent">
        <div className="pointer-events-auto flex items-center gap-3 rounded-3xl border border-border/60 bg-card/90 p-3 shadow-elegant backdrop-blur-xl">
          <button
            onClick={onGenerateShotImages}
            disabled={rendering}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-muted/60 py-4 text-sm font-bold tracking-tight text-foreground transition hover:bg-muted disabled:opacity-60"
            title={
              missingShotImages > 0
                ? `${missingShotImages} shot${missingShotImages === 1 ? "" : "s"} missing an image`
                : "All shots have images"
            }
          >
            Shots{missingShotImages > 0 ? ` · ${missingShotImages}` : ""}
          </button>
          <button
            onClick={onRenderFinal}
            disabled={rendering}
            className="flex flex-[1.6] items-center justify-center gap-2 rounded-2xl bg-brand-gradient py-4 text-base font-bold tracking-tight text-primary-foreground shadow-glow transition hover:opacity-95 disabled:opacity-60"
            title={
              missingClips > 0
                ? `${missingClips} shot${missingClips === 1 ? "" : "s"} still need animating · music + voiceover will also be generated`
                : "Re-render the final stitched MP4"
            }
          >
            Render final video
          </button>
        </div>
        {renderMsg && (
          <div className="pointer-events-auto mt-2 text-center text-xs text-muted-foreground">
            {renderMsg}
          </div>
        )}
      </div>
      )}
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

// ---------- gallery (app-mode: all generations) ----------

const GENERATION_KINDS = new Set([
  "image",
  "reference",
  "video",
  "audio",
  "music",
  "voiceover",
  "keyframe",
  "final",
]);

function GalleryGrid({ assets }: { assets: ProjectAsset[] }) {
  const items = assets.filter((a) => GENERATION_KINDS.has(a.kind));
  if (items.length === 0) {
    return (
      <EmptyHint
        icon={<LayoutGrid className="h-8 w-8" />}
        text="No generations yet — describe what you want in the chat to create your first one."
      />
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      {items
        .slice()
        .reverse()
        .map((a) => (
          <a
            key={a.id}
            href={a.url}
            target="_blank"
            rel="noreferrer"
            className="group relative block overflow-hidden rounded-2xl border border-border/60 bg-muted/40"
          >
            {a.mime.startsWith("image/") && (
              <img src={a.url} alt={a.label || a.name} className="aspect-square w-full object-cover" />
            )}
            {a.mime.startsWith("video/") && (
              <video src={a.url} className="aspect-square w-full object-cover" muted playsInline />
            )}
            {a.mime.startsWith("audio/") && (
              <div className="flex aspect-square w-full items-center justify-center bg-muted/60 p-3">
                <audio src={a.url} controls className="w-full" />
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-background/90 to-transparent px-3 py-2 text-xs font-medium text-foreground opacity-0 transition group-hover:opacity-100">
              {a.label || a.name}
            </div>
          </a>
        ))}
    </div>
  );
}

// ---------- renders panel ----------

function RendersPanel({
  projectId,
  activeJobId,
  onRetry,
  isRendering,
}: {
  projectId: string;
  activeJobId: string | null;
  onRetry: () => void;
  isRendering: boolean;
}) {
  const fetchRenders = useServerFn(listProjectRenders);
  const q = useQuery({
    queryKey: ["project-renders", projectId],
    queryFn: () => fetchRenders({ data: { projectId } }),
    // Refetch while a job is active so progress updates.
    refetchInterval: activeJobId ? 4_000 : false,
  });
  const queryClient = useQueryClient();

  // Also refetch when the active job id flips (started / cleared).
  useEffect(() => {
    void queryClient.invalidateQueries({
      queryKey: ["project-renders", projectId],
    });
  }, [activeJobId, projectId, queryClient]);

  const jobs = q.data?.jobs ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">
            Render queue
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {jobs.length === 0
              ? "No renders yet."
              : `${jobs.length} render${jobs.length === 1 ? "" : "s"}`}
          </div>
        </div>
        <button
          onClick={onRetry}
          disabled={isRendering}
          className="inline-flex items-center gap-2 rounded-full bg-brand-gradient px-4 py-2 text-sm font-bold text-primary-foreground shadow-glow transition hover:opacity-95 disabled:opacity-60"
        >
          <RotateCw className="h-4 w-4" /> New render
        </button>
      </div>

      {jobs.length === 0 && (
        <EmptyHint
          icon={<History className="h-8 w-8" />}
          text="Final video renders will appear here. Each retry kicks off a fresh job."
        />
      )}

      {jobs.map((job) => {
        const isVideo = !!job.finalMime?.startsWith("video/");
        const active =
          job.status === "queued" || job.status === "running";
        const failed = job.status === "failed";
        const done = job.status === "done";
        return (
          <div
            key={job.id}
            className="rounded-2xl border border-border/60 bg-card/40 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                      done
                        ? "bg-emerald-500/15 text-emerald-400"
                        : failed
                          ? "bg-destructive/15 text-destructive"
                          : "bg-amber-500/15 text-amber-400"
                    }`}
                  >
                    {active && (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    )}
                    {job.status}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(job.createdAt).toLocaleString()}
                  </span>
                </div>
                {job.stepsTotal > 0 && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    {job.stepsDone}/{job.stepsTotal} steps complete
                  </div>
                )}
                {failed && job.error && (
                  <div className="mt-2 line-clamp-3 text-xs text-destructive/90">
                    {job.error}
                  </div>
                )}
              </div>
              <button
                onClick={onRetry}
                disabled={isRendering}
                title="Kick off a new render"
                className="inline-flex items-center gap-2 rounded-full bg-muted/60 px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted disabled:opacity-60"
              >
                <RotateCw className="h-3.5 w-3.5" /> Retry
              </button>
            </div>
            {done && job.finalUrl && (
              <div className="mt-3 overflow-hidden rounded-xl bg-background">
                {isVideo ? (
                  <video
                    src={job.finalUrl}
                    controls
                    playsInline
                    className="block max-h-[360px] w-full"
                  />
                ) : (
                  <a
                    href={job.finalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block p-3 text-xs underline"
                  >
                    Open output
                  </a>
                )}
              </div>
            )}
          </div>
        );
      })}
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
            className="group relative overflow-hidden rounded-md border border-border/60 bg-muted/40"
            title={`${a.kind} · ${a.name}`}
          >
            {a.mime.startsWith("image/") ? (
              <img src={a.url} alt={a.name} className="h-16 w-16 object-cover" />
            ) : (
              <div className="grid h-16 w-16 place-items-center text-lg text-muted-foreground">
                {a.mime.startsWith("audio/") ? "♪" : a.mime.startsWith("video/") ? "▶" : "•"}
              </div>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-1 flex justify-center">
              <span className="rounded-full bg-black/70 px-2 py-0.5 text-[9px] font-semibold capitalize text-white backdrop-blur-sm">
                {a.kind}
              </span>
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
    { label: "Shots", value: sceneCount > 0 ? String(sceneCount) : "—" },
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
  aspectRatio,
  onClick,
  onChange,
}: {
  scene: Scene;
  active: boolean;
  aspectRatio?: string;
  onClick: () => void;
  onChange: (s: Scene) => void;
}) {
  const [editing, setEditing] = useState(false);
  // Parse "W:H" → aspect-ratio CSS value + orientation. Default to 16:9.
  const { ar, isHorizontal } = (() => {
    const m = (aspectRatio || "").match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
    if (!m) return { ar: "16 / 9", isHorizontal: true };
    const w = Number(m[1]);
    const h = Number(m[2]);
    return { ar: `${w} / ${h}`, isHorizontal: w >= h };
  })();

  const header = (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs font-semibold text-muted-foreground">#{scene.n}</span>
        <span className="truncate text-base font-bold tracking-tight">{scene.title}</span>
      </div>
      <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
        {scene.duration}s
      </span>
    </div>
  );

  const description = editing ? (
    <textarea
      autoFocus
      defaultValue={scene.prompt}
      onBlur={(e) => {
        onChange({ ...scene, prompt: e.target.value });
        setEditing(false);
      }}
      rows={5}
      className="mt-3 w-full resize-none rounded-xl border border-border bg-background/60 p-3 text-sm text-foreground focus:border-primary/60 focus:outline-none"
    />
  ) : (
    <p
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      className="mt-2 text-sm leading-relaxed text-muted-foreground hover:text-foreground"
    >
      {scene.prompt}
    </p>
  );

  const voiceover = (
    <div className="mt-3" onClick={(e) => e.stopPropagation()}>
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
        Voiceover (optional)
      </div>
      <textarea
        defaultValue={scene.voPrompt ?? ""}
        placeholder="What the narrator says during this shot…"
        onBlur={(e) => {
          const next = e.target.value;
          if (next !== (scene.voPrompt ?? "")) {
            onChange({ ...scene, voPrompt: next });
          }
        }}
        rows={2}
        className="w-full resize-none rounded-xl border border-border bg-background/60 p-3 text-sm text-foreground focus:border-primary/60 focus:outline-none"
      />
    </div>
  );

  const thumb = (
    <div
      className={`overflow-hidden rounded-xl bg-muted ${isHorizontal ? "w-full" : "w-72 shrink-0"}`}
      style={{ aspectRatio: ar }}
    >
      {scene.thumb ? (
        <img src={scene.thumb} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full w-full place-items-center text-muted-foreground/50">
          <Film className="h-7 w-7" />
        </div>
      )}
    </div>
  );

  return (
    <div
      onClick={onClick}
      className={`group cursor-pointer rounded-2xl border bg-card/40 p-5 transition ${
        active ? "border-primary/60 shadow-glow" : "border-border/60 hover:border-foreground/30"
      }`}
    >
      {isHorizontal ? (
        <div className="flex flex-col gap-4">
          {thumb}
          <div className="min-w-0">
            {header}
            {description}
            {voiceover}
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-4">
          {thumb}
          <div className="min-w-0 flex-1">
            {header}
            {description}
            {voiceover}
          </div>
        </div>
      )}
    </div>
  );
}