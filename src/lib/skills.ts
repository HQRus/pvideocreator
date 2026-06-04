// Static catalog of Fal-powered "skills" — capabilities that the studio can
// drive. Each entry maps to a single fal.ai model. Used by /skills (browse
// + launch a new project), the studio toolbar (pick mode + model), and the
// direct generation server fn.

import {
  Image as ImageIcon,
  Video as VideoIcon,
  Music as MusicIcon,
  Mic as MicIcon,
  type LucideIcon,
} from "lucide-react";

export type SkillKind = "image" | "video" | "audio" | "speech";

export type Skill = {
  id: string;
  label: string;
  description: string;
  category: string;
  kind: SkillKind;
  model: string; // fal model id
  icon: LucideIcon;
};

export const SKILLS: Skill[] = [
  // ── Image ──────────────────────────────────────────────────────────
  {
    id: "image-nano-banana",
    label: "Nano Banana",
    description: "Fast, vivid text-to-image. Great for moodboards and ideation.",
    category: "Image",
    kind: "image",
    model: "fal-ai/nano-banana",
    icon: ImageIcon,
  },
  {
    id: "image-nano-banana-edit",
    label: "Nano Banana Edit",
    description: "Edit or re-mix existing images while preserving identity.",
    category: "Image",
    kind: "image",
    model: "fal-ai/nano-banana/edit",
    icon: ImageIcon,
  },
  {
    id: "image-flux-schnell",
    label: "Flux Schnell",
    description: "Snappy Flux variant — high quality at low latency.",
    category: "Image",
    kind: "image",
    model: "fal-ai/flux/schnell",
    icon: ImageIcon,
  },
  {
    id: "image-flux-pro",
    label: "Flux Pro 1.1",
    description: "Top-tier photoreal Flux — slower, premium fidelity.",
    category: "Image",
    kind: "image",
    model: "fal-ai/flux-pro/v1.1",
    icon: ImageIcon,
  },
  {
    id: "image-ideogram",
    label: "Ideogram v3",
    description: "Best in class for text-in-image, posters, and typography.",
    category: "Image",
    kind: "image",
    model: "fal-ai/ideogram/v3",
    icon: ImageIcon,
  },

  // ── Video ──────────────────────────────────────────────────────────
  {
    id: "video-kling-i2v",
    label: "Kling 2.1 — Image to Video",
    description: "Animate a still image with motion direction.",
    category: "Video",
    kind: "video",
    model: "fal-ai/kling-video/v2.1/standard/image-to-video",
    icon: VideoIcon,
  },
  {
    id: "video-kling-t2v",
    label: "Kling 2.1 — Text to Video",
    description: "Generate a short clip from a written description.",
    category: "Video",
    kind: "video",
    model: "fal-ai/kling-video/v2.1/standard/text-to-video",
    icon: VideoIcon,
  },
  {
    id: "video-luma",
    label: "Luma Dream Machine",
    description: "Cinematic, dreamy motion. Great for vibes and montages.",
    category: "Video",
    kind: "video",
    model: "fal-ai/luma-dream-machine",
    icon: VideoIcon,
  },
  {
    id: "video-minimax",
    label: "MiniMax Video",
    description: "Fast text-to-video with crisp subjects.",
    category: "Video",
    kind: "video",
    model: "fal-ai/minimax/video-01",
    icon: VideoIcon,
  },

  // ── Music / Audio ─────────────────────────────────────────────────
  {
    id: "audio-cassette",
    label: "Cassette Music",
    description: "Quick original music bed from a text prompt.",
    category: "Music",
    kind: "audio",
    model: "fal-ai/cassetteai/music-generator",
    icon: MusicIcon,
  },
  {
    id: "audio-stable",
    label: "Stable Audio",
    description: "High-quality original music and SFX.",
    category: "Music",
    kind: "audio",
    model: "fal-ai/stable-audio",
    icon: MusicIcon,
  },

  // ── Speech ────────────────────────────────────────────────────────
  {
    id: "speech-elevenlabs",
    label: "ElevenLabs Multilingual",
    description: "Studio-grade voiceover in dozens of voices and languages.",
    category: "Speech",
    kind: "speech",
    model: "fal-ai/elevenlabs/tts/multilingual-v2",
    icon: MicIcon,
  },
  {
    id: "speech-playht",
    label: "PlayHT v3",
    description: "Natural conversational TTS, great for narration.",
    category: "Speech",
    kind: "speech",
    model: "fal-ai/playai/tts/v3",
    icon: MicIcon,
  },
];

export const SKILL_BY_ID: Record<string, Skill> = Object.fromEntries(
  SKILLS.map((s) => [s.id, s]),
);

export const SKILL_BY_MODEL: Record<string, Skill> = Object.fromEntries(
  SKILLS.map((s) => [s.model, s]),
);

export const SKILL_CATEGORIES = Array.from(
  new Set(SKILLS.map((s) => s.category)),
);

export const SKILLS_BY_KIND = (kind: SkillKind): Skill[] =>
  SKILLS.filter((s) => s.kind === kind);

export const DEFAULT_MODEL_BY_KIND: Record<SkillKind, string> = {
  image: "fal-ai/nano-banana",
  video: "fal-ai/kling-video/v2.1/standard/text-to-video",
  audio: "fal-ai/cassetteai/music-generator",
  speech: "fal-ai/elevenlabs/tts/multilingual-v2",
};

export type StudioMode = "agent" | SkillKind;

export const STUDIO_MODES: { id: StudioMode; label: string }[] = [
  { id: "agent", label: "Agent" },
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Music" },
  { id: "speech", label: "Speech" },
];