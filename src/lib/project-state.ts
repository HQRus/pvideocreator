import sample1 from "@/assets/sample-1.jpg";
import sample2 from "@/assets/sample-2.jpg";
import sample3 from "@/assets/sample-3.jpg";
import sample4 from "@/assets/sample-4.jpg";

export type Scene = {
  id: string;
  n: number;
  title: string;
  prompt: string;
  duration: number;
  thumb: string;
  status: "ready" | "drafting" | "rendering";
};

export type Character = {
  id: string;
  name: string;
  role: string;
  ref: string;
  notes: string;
};

export type Music = {
  title: string;
  artist: string;
  bpm: number;
  key: string;
  beats: number[];
  duration: number;
};

export type ProjectMeta = {
  title: string;
  format: string; // "Music video", "Short film", ...
  aspectRatio: string; // "9:16", "16:9", ...
};

export type ProjectState = {
  meta: ProjectMeta;
  scenes: Scene[];
  cast: Character[];
  music: Music;
};

// Patches the model can emit. Each field, if present, replaces (or in the
// case of *Append, extends) that slice of state. Keep this loose — we
// validate field-by-field in applyPatch.
export type ProjectPatch = Partial<{
  meta: Partial<ProjectMeta>;
  scenes: Partial<Scene>[];
  scenesAppend: Partial<Scene>[];
  cast: Partial<Character>[];
  castAppend: Partial<Character>[];
  music: Partial<Music>;
}>;

const SAMPLE_THUMBS = [sample1, sample2, sample3, sample4];

export const INITIAL_PROJECT: ProjectState = {
  meta: {
    title: "Neon Drift",
    format: "Music video",
    aspectRatio: "9:16",
  },
  scenes: [
    { id: "s1", n: 1, title: "Cold open — neon street", prompt: "Wide shot, rain-soaked Tokyo alley at midnight. Neon signs flicker. A lone figure walks toward camera, silhouette only.", duration: 6, thumb: sample1, status: "ready" },
    { id: "s2", n: 2, title: "Close-up — the helmet", prompt: "Extreme close-up on a chrome motorcycle helmet, reflections of neon glide across the visor.", duration: 4, thumb: sample3, status: "ready" },
    { id: "s3", n: 3, title: "Drift sequence", prompt: "Tracking shot, bike drifting around a wet corner, sparks. Slow motion, 60fps.", duration: 8, thumb: sample2, status: "rendering" },
    { id: "s4", n: 4, title: "Skyline reveal", prompt: "Drone pull-back revealing the futuristic skyline. Camera rises through clouds.", duration: 6, thumb: sample4, status: "drafting" },
    { id: "s5", n: 5, title: "Logo card", prompt: "Brand logo materializes from particles on black background. Subtle hum.", duration: 3, thumb: sample1, status: "drafting" },
  ],
  cast: [
    { id: "c1", name: "The Rider", role: "Protagonist", ref: sample3, notes: "Mid-20s, androgynous, chrome helmet, charcoal racing suit." },
    { id: "c2", name: "The Voice", role: "Narrator (VO)", ref: sample2, notes: "Low warm female voice, intimate, slight reverb." },
  ],
  music: {
    title: "Midnight Drift",
    artist: "Generated · synthwave",
    bpm: 96,
    key: "F# minor",
    beats: [0.0, 2.5, 5.0, 7.5, 10.0, 12.5, 15.0, 17.5, 20.0, 22.5, 25.0],
    duration: 27,
  },
};

let idCounter = 1000;
const newId = (prefix: string) => `${prefix}${++idCounter}`;

function normalizeScene(s: Partial<Scene>, fallbackN: number): Scene {
  return {
    id: s.id ?? newId("s"),
    n: typeof s.n === "number" ? s.n : fallbackN,
    title: s.title ?? "Untitled scene",
    prompt: s.prompt ?? "",
    duration: typeof s.duration === "number" ? s.duration : 5,
    thumb: s.thumb ?? SAMPLE_THUMBS[(fallbackN - 1) % SAMPLE_THUMBS.length],
    status: s.status ?? "drafting",
  };
}

function normalizeCharacter(c: Partial<Character>, idx: number): Character {
  return {
    id: c.id ?? newId("c"),
    name: c.name ?? "Unnamed",
    role: c.role ?? "Character",
    ref: c.ref ?? SAMPLE_THUMBS[idx % SAMPLE_THUMBS.length],
    notes: c.notes ?? "",
  };
}

export function applyPatch(
  state: ProjectState,
  patch: ProjectPatch | null | undefined,
): ProjectState {
  if (!patch || typeof patch !== "object") return state;
  let next = state;

  if (patch.meta) {
    next = { ...next, meta: { ...next.meta, ...patch.meta } };
  }

  if (Array.isArray(patch.scenes)) {
    next = {
      ...next,
      scenes: patch.scenes.map((s, i) => normalizeScene(s, i + 1)),
    };
  } else if (Array.isArray(patch.scenesAppend)) {
    const base = next.scenes.length;
    next = {
      ...next,
      scenes: [
        ...next.scenes,
        ...patch.scenesAppend.map((s, i) => normalizeScene(s, base + i + 1)),
      ],
    };
  }

  if (Array.isArray(patch.cast)) {
    next = {
      ...next,
      cast: patch.cast.map((c, i) => normalizeCharacter(c, i)),
    };
  } else if (Array.isArray(patch.castAppend)) {
    const base = next.cast.length;
    next = {
      ...next,
      cast: [
        ...next.cast,
        ...patch.castAppend.map((c, i) => normalizeCharacter(c, base + i)),
      ],
    };
  }

  if (patch.music) {
    next = { ...next, music: { ...next.music, ...patch.music } };
  }

  return next;
}