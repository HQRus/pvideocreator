export type Scene = {
  id: string;
  n: number;
  title: string;
  prompt: string;
  duration: number;
  thumb: string;
  status: "ready" | "drafting" | "rendering";
  // Motion / camera direction used when generating the video clip from
  // the keyframe (e.g. "slow push-in, handheld, board flicks up at 0:02").
  motionPrompt?: string;
  // Optional voiceover line read during this shot.
  voPrompt?: string;
  // URL of the rendered video clip for this scene, once production finishes.
  clipUrl?: string;
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

// User-provided or AI-generated reference assets attached to the project.
// `kind` tells the panel where to surface it (likeness → Cast tab,
// audio refs → Audio tab, anything else → Overview).
export type AssetKind =
  | "likeness"
  | "logo"
  | "reference"
  | "keyframe"
  | "music"
  | "voiceover"
  | "final"
  | "voice"
  | "audio"
  | "video"
  | "other";

export type ProjectAsset = {
  id: string;
  kind: AssetKind;
  mime: string;
  name: string;
  url: string; // blob: URL today, https: when we move to Cloud storage
  label?: string;
  attachedTo?: string; // e.g. character id, scene id
  width?: number;
  height?: number;
  duration?: number;
};

export type ProjectMeta = {
  title: string;
  format: string; // "Music video", "Short film", ...
  aspectRatio: string; // "9:16", "16:9", ...
  logline: string; // 1–2 sentence evolving description of the video
  targetDuration: string; // human-readable length, e.g. "30s", "2 min"
  fps: string; // "24", "30", "60"
  resolution: string; // "1080p", "4K"
};

export type ProjectState = {
  meta: ProjectMeta;
  scenes: Scene[];
  cast: Character[];
  music: Music;
  assets: ProjectAsset[];
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
  assets: Partial<ProjectAsset>[];
  assetsAppend: Partial<ProjectAsset>[];
}>;

export const INITIAL_PROJECT: ProjectState = {
  meta: {
    title: "Untitled project",
    format: "—",
    aspectRatio: "—",
    logline: "",
    targetDuration: "",
    fps: "",
    resolution: "",
  },
  scenes: [],
  cast: [],
  music: null,
  assets: [],
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
    motionPrompt: s.motionPrompt,
    voPrompt: s.voPrompt,
    clipUrl: s.clipUrl,
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

function normalizeAsset(a: Partial<ProjectAsset>): ProjectAsset {
  return {
    id: a.id ?? newId("ast"),
    kind: a.kind ?? "reference",
    mime: a.mime ?? "application/octet-stream",
    name: a.name ?? "asset",
    url: a.url ?? "",
    label: a.label,
    attachedTo: a.attachedTo,
    width: a.width,
    height: a.height,
    duration: a.duration,
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

  if (Array.isArray(patch.assets)) {
    next = { ...next, assets: patch.assets.map(normalizeAsset) };
  } else if (Array.isArray(patch.assetsAppend)) {
    next = {
      ...next,
      assets: [...next.assets, ...patch.assetsAppend.map(normalizeAsset)],
    };
  }

  return next;
}