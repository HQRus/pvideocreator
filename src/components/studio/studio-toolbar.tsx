import { useState } from "react";
import {
  Bot,
  ChevronDown,
  Image as ImageIcon,
  Mic as MicIcon,
  Music as MusicIcon,
  Sparkles,
  Video as VideoIcon,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SKILLS,
  SKILLS_BY_KIND,
  SKILL_CATEGORIES,
  STUDIO_MODES,
  type Skill,
  type StudioMode,
} from "@/lib/skills";

const MODE_ICON: Record<StudioMode, React.ComponentType<{ className?: string }>> = {
  agent: Bot,
  image: ImageIcon,
  video: VideoIcon,
  audio: MusicIcon,
  speech: MicIcon,
};

export type StudioToolbarProps = {
  mode: StudioMode;
  model: string | null;
  onChange: (next: { mode: StudioMode; model: string | null }) => void;
};

export function StudioToolbar({ mode, model, onChange }: StudioToolbarProps) {
  const [skillsOpen, setSkillsOpen] = useState(false);
  const agent = mode === "agent";
  const kindModels =
    mode === "agent" ? [] : SKILLS_BY_KIND(mode);

  const setMode = (next: StudioMode) => {
    if (!next || !STUDIO_MODES.some((m) => m.id === next)) return;
    if (next === "agent") return onChange({ mode: "agent", model: null });
    const list = SKILLS_BY_KIND(next);
    // Preserve current model if it still applies, else default to the first.
    const stillValid = list.find((s) => s.model === model);
    onChange({
      mode: next,
      model: stillValid?.model ?? list[0]?.model ?? null,
    });
  };

  const pickSkill = (s: Skill) => {
    setSkillsOpen(false);
    onChange({ mode: s.kind, model: s.model });
  };

  const ModeIcon = MODE_ICON[mode];
  const currentLabel = STUDIO_MODES.find((m) => m.id === mode)?.label ?? mode;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/60 bg-card/70 px-3 py-2 text-sm">
      {/* Unified mode dropdown */}
      <Select
        value={mode}
        onValueChange={(v) => setMode(v as StudioMode)}
      >
        <SelectTrigger className="h-8 w-auto min-w-[140px] rounded-full bg-muted/60 px-3 text-xs">
          <div className="flex items-center gap-1.5">
            <ModeIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-semibold">{currentLabel}</span>
          </div>
        </SelectTrigger>
        <SelectContent>
          {STUDIO_MODES.map((m) => {
            const Icon = MODE_ICON[m.id];
            return (
              <SelectItem key={m.id} value={m.id} className="text-xs">
                <div className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  {m.label}
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      {/* Model dropdown — to the right of mode selector */}
      {!agent && kindModels.length > 0 && (
        <Select
          value={model ?? kindModels[0].model}
          onValueChange={(v) => onChange({ mode, model: v })}
        >
          <SelectTrigger className="h-8 w-auto min-w-[180px] rounded-full bg-muted/60 px-3 text-xs">
            <SelectValue placeholder="Pick a model" />
          </SelectTrigger>
          <SelectContent>
            {kindModels.map((s) => (
              <SelectItem key={s.id} value={s.model} className="text-xs">
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="flex-1" />

      {/* Skills popover — full catalog regardless of current mode */}
      <Popover open={skillsOpen} onOpenChange={setSkillsOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-full bg-muted/60 px-3 py-1 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
          >
            <Sparkles className="h-3.5 w-3.5" /> Skills
            <ChevronDown className="h-3 w-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-[360px] max-h-[60vh] overflow-y-auto p-0"
        >
          {SKILL_CATEGORIES.map((cat) => (
            <div key={cat} className="border-b border-border/60 last:border-b-0">
              <div className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {cat}
              </div>
              <ul className="px-1.5 pb-2">
                {SKILLS.filter((s) => s.category === cat).map((s) => {
                  const Icon = s.icon;
                  const active = s.model === model && s.kind === mode;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => pickSkill(s)}
                        className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition ${
                          active ? "bg-muted" : "hover:bg-muted/60"
                        }`}
                      >
                        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-foreground">
                            {s.label}
                          </div>
                          <div className="truncate text-[11px] text-muted-foreground">
                            {s.description}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}