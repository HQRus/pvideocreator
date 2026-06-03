import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Copy, Trash2, Music2, Mic, Volume2, Film } from "lucide-react";
import type { Scene, Music, ProjectAsset } from "@/lib/project-state";
import { cn } from "@/lib/utils";

// pixels per second baseline; clamped by zoom
const BASE_PPS = 60;
const MIN_DUR = 0.5;
const MAX_DUR = 60;

export function TimelinePanel({
  scenes,
  setScenes,
  activeSceneId,
  onSelect,
  music,
  assets,
}: {
  scenes: Scene[];
  setScenes: (s: Scene[]) => void;
  activeSceneId: string;
  onSelect: (id: string) => void;
  music: Music;
  assets: ProjectAsset[];
}) {
  const [zoom, setZoom] = useState(1);
  const pps = BASE_PPS * zoom;
  const totalDuration = scenes.reduce((acc, s) => acc + (s.duration || 0), 0);

  const trackRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0); // seconds across full timeline
  const [playIdx, setPlayIdx] = useState(0);

  // Cumulative starts per scene
  const starts = useMemo(() => {
    const out: number[] = [];
    let t = 0;
    for (const s of scenes) {
      out.push(t);
      t += s.duration || 0;
    }
    return out;
  }, [scenes]);

  const beats = music?.beats ?? [];
  const snapToBeat = (t: number) => {
    if (!beats.length) return t;
    let best = t;
    let bestD = Infinity;
    for (const b of beats) {
      const d = Math.abs(b - t);
      if (d < bestD && d < 0.15) {
        bestD = d;
        best = b;
      }
    }
    return best;
  };

  // --- Drag-to-reorder ---
  const onDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("text/scene-id", id);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDropOn = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const src = e.dataTransfer.getData("text/scene-id");
    if (!src || src === targetId) return;
    const next = [...scenes];
    const from = next.findIndex((s) => s.id === src);
    const to = next.findIndex((s) => s.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setScenes(next.map((s, i) => ({ ...s, n: i + 1 })));
  };

  // --- Resize duration by dragging right edge ---
  const beginResize = (e: React.PointerEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const scene = scenes.find((s) => s.id === id);
    if (!scene) return;
    const startDur = scene.duration || 1;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      let next = Math.max(MIN_DUR, Math.min(MAX_DUR, startDur + dx / pps));
      // snap end to nearest beat
      const start = starts[scenes.findIndex((s) => s.id === id)] ?? 0;
      const snapped = snapToBeat(start + next);
      next = Math.max(MIN_DUR, snapped - start);
      setScenes(scenes.map((s) => (s.id === id ? { ...s, duration: Number(next.toFixed(2)) } : s)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onDelete = (id: string) => {
    setScenes(scenes.filter((s) => s.id !== id).map((s, i) => ({ ...s, n: i + 1 })));
  };
  const onDuplicate = (id: string) => {
    const idx = scenes.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const orig = scenes[idx];
    const copy: Scene = { ...orig, id: `${orig.id}-copy-${Date.now().toString(36)}` };
    const next = [...scenes.slice(0, idx + 1), copy, ...scenes.slice(idx + 1)];
    setScenes(next.map((s, i) => ({ ...s, n: i + 1 })));
  };

  // --- Playback (chain clipUrls) ---
  const playable = scenes.filter((s) => s.clipUrl);
  const canPlay = playable.length > 0;
  useEffect(() => {
    if (!playing) return;
    const v = videoRef.current;
    if (!v) return;
    const scene = playable[playIdx];
    if (!scene?.clipUrl) {
      setPlaying(false);
      return;
    }
    v.src = scene.clipUrl;
    v.play().catch(() => setPlaying(false));
    const onTime = () => {
      const sceneStart = scenes
        .slice(0, scenes.findIndex((s) => s.id === scene.id))
        .reduce((a, s) => a + (s.duration || 0), 0);
      setPlayhead(sceneStart + v.currentTime);
    };
    const onEnd = () => {
      if (playIdx + 1 < playable.length) setPlayIdx(playIdx + 1);
      else {
        setPlaying(false);
        setPlayIdx(0);
      }
    };
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("ended", onEnd);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("ended", onEnd);
      v.pause();
    };
  }, [playing, playIdx, playable, scenes]);

  const togglePlay = () => {
    if (!canPlay) return;
    if (playing) {
      setPlaying(false);
      videoRef.current?.pause();
    } else {
      setPlayIdx(0);
      setPlayhead(0);
      setPlaying(true);
    }
  };

  // --- Scrub by clicking ruler ---
  const onRulerClick = (e: React.MouseEvent) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left + (trackRef.current?.scrollLeft ?? 0);
    const t = Math.max(0, x / pps);
    setPlayhead(Math.min(totalDuration, t));
    // jump to scene containing t
    let acc = 0;
    for (const s of scenes) {
      if (t >= acc && t < acc + (s.duration || 0)) {
        onSelect(s.id);
        break;
      }
      acc += s.duration || 0;
    }
  };

  // Time ticks every 1s, labels every 5s
  const ticks: { t: number; label: boolean }[] = [];
  for (let t = 0; t <= Math.max(totalDuration, 1); t++) {
    ticks.push({ t, label: t % 5 === 0 });
  }

  if (scenes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center text-base text-muted-foreground">
        Add scenes to see them on the timeline.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-card/30">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 border-b border-border/40 px-6 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={togglePlay}
            disabled={!canPlay}
            className={cn(
              "flex h-9 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-bold text-background transition-opacity",
              !canPlay && "opacity-40",
            )}
            title={canPlay ? "Play stitched preview" : "Render clips first to enable playback"}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {playing ? "Pause" : "Play"}
          </button>
          <span className="ml-2 font-mono text-sm tabular-nums text-muted-foreground">
            {fmt(playhead)} / {fmt(totalDuration)}
          </span>
          {!canPlay && (
            <span className="text-xs text-muted-foreground">
              · render scenes to preview
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {music && beats.length > 0 && (
            <span className="flex items-center gap-1">
              <Music2 className="h-3 w-3" /> {beats.length} beats · snap on
            </span>
          )}
          <label className="flex items-center gap-2">
            Zoom
            <input
              type="range"
              min={0.4}
              max={3}
              step={0.1}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>
        </div>
      </div>

      {/* Preview video (visible only while clips exist) */}
      {canPlay && (
        <div className="border-b border-border/40 bg-black">
          <video
            ref={videoRef}
            className="mx-auto max-h-[40vh] w-auto"
            playsInline
            muted={false}
          />
        </div>
      )}

      {/* Timeline */}
      <div ref={trackRef} className="relative flex-1 overflow-x-auto overflow-y-hidden">
        <div
          style={{ width: Math.max(totalDuration * pps + 200, 800) }}
          className="relative h-full select-none pt-2"
        >
          {/* Ruler */}
          <div
            onClick={onRulerClick}
            className="relative h-7 cursor-pointer border-b border-border/40"
          >
            {ticks.map(({ t, label }) => (
              <div
                key={t}
                className="absolute top-0 h-full"
                style={{ left: t * pps }}
              >
                <div
                  className={cn(
                    "w-px bg-border",
                    label ? "h-full" : "h-2",
                  )}
                />
                {label && (
                  <span className="absolute left-1 top-0 font-mono text-[10px] text-muted-foreground">
                    {t}s
                  </span>
                )}
              </div>
            ))}
            {/* Beat markers */}
            {beats.map((b, i) => (
              <div
                key={`b${i}`}
                className="absolute top-0 h-full w-px bg-primary/40"
                style={{ left: b * pps }}
                title={`beat ${i + 1} @ ${b.toFixed(2)}s`}
              />
            ))}
          </div>

          {/* Scene track */}
          <div className="relative mt-3 flex h-32 items-stretch gap-1 px-0">
            {scenes.map((s, i) => {
              const w = Math.max(40, (s.duration || 1) * pps);
              const left = (starts[i] ?? 0) * pps;
              const active = s.id === activeSceneId;
              return (
                <div
                  key={s.id}
                  draggable
                  onDragStart={(e) => onDragStart(e, s.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => onDropOn(e, s.id)}
                  onClick={() => onSelect(s.id)}
                  className={cn(
                    "group absolute top-0 flex h-full cursor-grab overflow-hidden rounded-lg border-2 bg-background shadow-sm transition-colors active:cursor-grabbing",
                    active
                      ? "border-foreground ring-2 ring-foreground/20"
                      : "border-border/60 hover:border-foreground/40",
                  )}
                  style={{ left, width: w }}
                >
                  {s.thumb ? (
                    <img
                      src={s.thumb}
                      alt={s.title}
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-muted text-xs text-muted-foreground">
                      no key
                    </div>
                  )}
                  {/* overlay info */}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/80 to-transparent p-1.5 text-[10px] font-semibold text-white">
                    <span className="truncate">
                      {s.n}. {s.title}
                    </span>
                    <span className="font-mono tabular-nums">{(s.duration || 0).toFixed(1)}s</span>
                  </div>
                  {/* hover actions */}
                  <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDuplicate(s.id);
                      }}
                      className="rounded bg-black/60 p-1 text-white hover:bg-black/80"
                      title="Duplicate"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(s.id);
                      }}
                      className="rounded bg-black/60 p-1 text-white hover:bg-red-600"
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  {/* resize handle */}
                  <div
                    onPointerDown={(e) => beginResize(e, s.id)}
                    className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-foreground/0 hover:bg-foreground/40"
                    title="Drag to retime"
                  />
                </div>
              );
            })}
          </div>

          {/* Playhead */}
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-red-500"
            style={{ left: playhead * pps }}
          >
            <div className="absolute -left-[5px] -top-1 h-3 w-3 rotate-45 bg-red-500" />
          </div>
        </div>
      </div>
    </div>
  );
}

function fmt(t: number) {
  const s = Math.max(0, Math.floor(t));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}