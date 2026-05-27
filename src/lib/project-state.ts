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
} | null;

export type ProjectMeta = {
  title: string;
  format: string; // "Music video", "Short film", ...
  aspectRatio: string; // "9:16", "16:9", ...
  logline: string; // 1–2 sentence evolving description of the video
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
  music: Partial<NonNullable<Music>>;
}>;

export const INITIAL_PROJECT: ProjectState = {
  meta: {
    title: "Untitled project",
    format: "—",
    aspectRatio: "—",
    logline: "",
  },
  scenes: [],
  cast: [],
  music: null,
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
    thumb: s.thumb ?? "",
    status: s.status ?? "drafting",
  };
}

function normalizeCharacter(c: Partial<Character>, idx: number): Character {
  return {
    id: c.id ?? newId("c"),
    name: c.name ?? "Unnamed",
    role: c.role ?? "Character",
    ref: c.ref ?? "",
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
    const base = next.music ?? {
      title: "",
      artist: "",
      bpm: 0,
      key: "",
      beats: [],
      duration: 0,
    };
    next = { ...next, music: { ...base, ...patch.music } };
  }

  return next;
}