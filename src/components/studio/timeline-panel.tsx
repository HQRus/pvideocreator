import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Copy, Trash2, Music2, Mic, Volume2, Film } from "lucide-react";
import type { Scene, Music, ProjectAsset } from "@/lib/project-state";
import { cn } from "@/lib/utils";

// pixels per second baseline; clamped by zoom
const BASE_PPS = 60;
const MIN_DUR = 0.5;
const MAX_DUR = 60;

function TimelinePanelImpl({
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
  const playheadRef = useRef<HTMLDivElement>(null);
  const timeLabelRef = useRef<HTMLSpanElement>(null);
  const playheadTimeRef = useRef(0);

  // Keep refs aligned with state when not playing (scrubbing, zoom changes, etc.)
  useEffect(() => {
    playheadTimeRef.current = playhead;
    if (playheadRef.current) {
      playheadRef.current.style.transform = `translate3d(${playhead * pps}px, 0, 0)`;
    }
    if (timeLabelRef.current) {
      timeLabelRef.current.textContent = `${fmt(playhead)} / ${fmt(totalDuration)}`;
    }
  }, [playhead, pps, totalDuration]);

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
  const hasClips = playable.length > 0;
  const canPlay = scenes.length > 0; // animatic preview works without clips

  // Animatic playback: when no rendered clips exist, advance the playhead via rAF
  // so the scrubber moves and the keyframe preview switches scenes in realtime.
  // We drive the playhead position and time label via refs so we don't re-render
  // the entire timeline (with all scenes / waveforms) every frame.
  useEffect(() => {
    if (!playing || hasClips) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      let next = playheadTimeRef.current + dt;
      if (next >= totalDuration) {
        next = totalDuration;
        playheadTimeRef.current = next;
        if (playheadRef.current) {
          playheadRef.current.style.transform = `translate3d(${next * pps}px, 0, 0)`;
        }
        if (timeLabelRef.current) {
          timeLabelRef.current.textContent = `${fmt(next)} / ${fmt(totalDuration)}`;
        }
        setPlayhead(next);
        setPlaying(false);
        return;
      }
      playheadTimeRef.current = next;
      // DOM-only updates → no React re-render per frame.
      if (playheadRef.current) {
        playheadRef.current.style.transform = `translate3d(${next * pps}px, 0, 0)`;
      }
      if (timeLabelRef.current) {
        timeLabelRef.current.textContent = `${fmt(next)} / ${fmt(totalDuration)}`;
      }
      // Only sync React state when crossing into a new scene.
      let acc = 0;
      for (const s of scenes) {
        const end = acc + (s.duration || 0);
        if (next >= acc && next < end) {
          if (s.id !== activeSceneId) onSelect(s.id);
          break;
        }
        acc = end;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // commit final time back to state so paused position is accurate
      setPlayhead(playheadTimeRef.current);
    };
  }, [playing, hasClips, totalDuration, scenes, activeSceneId, onSelect, pps]);

  useEffect(() => {
    if (!playing || !hasClips) return;
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
  }, [playing, hasClips, playIdx, playable, scenes]);

  const togglePlay = () => {
    if (!canPlay) return;
    if (playing) {
      setPlaying(false);
      videoRef.current?.pause();
    } else {
      setPlayIdx(0);
      if (playhead >= totalDuration - 0.05) setPlayhead(0);
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
            title={
              !canPlay
                ? "Add scenes to enable playback"
                : hasClips
                  ? "Play stitched preview"
                  : "Play animatic (keyframes)"
            }
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {playing ? "Pause" : "Play"}
          </button>
          <span
            ref={timeLabelRef}
            className="ml-2 font-mono text-sm tabular-nums text-muted-foreground"
          >
            {fmt(playhead)} / {fmt(totalDuration)}
          </span>
          {canPlay && !hasClips && (
            <span className="text-xs text-muted-foreground">
              · animatic preview (render clips for video)
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

      {/* Large preview — compact so timeline stays visible */}
      <div className="flex h-48 min-h-0 items-center justify-center overflow-hidden border-b border-border/40 bg-black">
        {hasClips ? (
          <video
            ref={videoRef}
            className="max-h-full max-w-full"
            playsInline
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
            {(() => {
              // show keyframe at current playhead
              let acc = 0;
              const cur = scenes.find((s) => {
                const end = acc + (s.duration || 0);
                const hit = playhead >= acc && playhead < end;
                acc = end;
                return hit;
              }) ?? scenes[0];
              return cur?.thumb ? (
                <img src={cur.thumb} alt={cur.title} className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="text-sm">No preview yet — generate keyframes and clips.</span>
              );
            })()}
          </div>
        )}
      </div>

      {/* Timeline — fixed-height footer, horizontal scroll only */}
      <div ref={trackRef} className="relative shrink-0 overflow-x-auto overflow-y-hidden bg-card/40">
        <div
          style={{ width: Math.max(totalDuration * pps + 40, 600) }}
          className="relative select-none px-3 pt-1 pb-3"
        >
          {/* Ruler */}
          <div
            onClick={onRulerClick}
            className="relative h-5 cursor-pointer"
          >
            {ticks.map(({ t, label }) => (
              <div
                key={t}
                className="absolute top-0 h-full"
                style={{ left: t * pps }}
              >
                <div
                  className={cn(
                    "w-px bg-border/70",
                    label ? "h-2" : "h-1",
                  )}
                />
                {label && (
                  <span className="absolute left-1 top-1 font-mono text-[10px] text-muted-foreground">
                    {t}s
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Video / scenes strip */}
          <div className="relative mt-1 flex h-16 items-stretch">
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
                    <div className="flex h-full w-full items-center justify-center bg-muted text-[10px] text-muted-foreground">
                      {s.n}
                    </div>
                  )}
                  {/* hover actions */}
                  <div className="absolute right-0.5 top-0.5 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDuplicate(s.id);
                      }}
                      className="rounded bg-black/60 p-0.5 text-white hover:bg-black/80"
                      title="Duplicate"
                    >
                      <Copy className="h-2.5 w-2.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(s.id);
                      }}
                      className="rounded bg-black/60 p-0.5 text-white hover:bg-red-600"
                      title="Delete"
                    >
                      <Trash2 className="h-2.5 w-2.5" />
                    </button>
                  </div>
                  {/* resize handle */}
                  <div
                    onPointerDown={(e) => beginResize(e, s.id)}
                    className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize bg-foreground/0 hover:bg-foreground/40"
                    title="Drag to retime"
                  />
                </div>
              );
            })}
          </div>

          {music && (
            <div
              className="relative mt-1.5 flex h-9 items-center overflow-hidden rounded-md border border-indigo-400/40 bg-indigo-500/25 px-2"
              style={{ width: Math.max((music.duration || totalDuration) * pps, 40) }}
              title={`${music.title}${music.artist ? " — " + music.artist : ""}`}
            >
              <Music2 className="absolute left-1.5 top-1.5 z-10 h-3 w-3 text-indigo-900" />
              <span className="absolute left-6 top-1 z-10 truncate text-[10px] font-semibold text-indigo-950">
                {music.title || "Music"}
              </span>
              {beats.map((b, i) => (
                <div
                  key={`mb${i}`}
                  className="absolute top-1 bottom-1 w-px bg-indigo-700/70"
                  style={{ left: b * pps }}
                />
              ))}
            </div>
          )}
          {assets
            .filter((a) => a.kind === "voice" || a.kind === "audio")
            .map((a) => {
              const dur = a.duration && a.duration > 0 ? a.duration : Math.max(totalDuration, 5);
              const isVoice = a.kind === "voice";
              return (
                <div
                  key={a.id}
                  className={cn(
                    "relative mt-1.5 flex h-9 items-center overflow-hidden rounded-md border px-2",
                    isVoice
                      ? "border-amber-500/50 bg-amber-400/30"
                      : "border-emerald-500/50 bg-emerald-400/30",
                  )}
                  style={{ width: Math.max(dur * pps, 40) }}
                  title={`${a.name} · ${dur.toFixed(1)}s`}
                >
                  {isVoice ? (
                    <Mic className="absolute left-1.5 top-1.5 z-10 h-3 w-3 text-amber-900" />
                  ) : (
                    <Volume2 className="absolute left-1.5 top-1.5 z-10 h-3 w-3 text-emerald-900" />
                  )}
                  <span
                    className={cn(
                      "absolute left-6 top-1 z-10 truncate text-[10px] font-semibold",
                      isVoice ? "text-amber-950" : "text-emerald-950",
                    )}
                  >
                    {a.label || a.name}
                  </span>
                  <div className="absolute inset-x-1 inset-y-0 flex items-center gap-[2px] overflow-hidden pl-20">
                    {Array.from({ length: Math.floor(dur * 8) }).map((_, i) => (
                      <div
                        key={i}
                        className={cn(
                          "w-[2px] rounded",
                          isVoice ? "bg-amber-700" : "bg-emerald-700",
                        )}
                        style={{ height: `${30 + ((i * 37) % 60)}%` }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

          {/* Playhead */}
          <div
            ref={playheadRef}
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-red-500"
            style={{
              left: 12 /* px-3 offset */,
              transform: `translate3d(${playhead * pps}px, 0, 0)`,
              willChange: "transform",
            }}
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
export const TimelinePanel = memo(TimelinePanelImpl);
