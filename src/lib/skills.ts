// Static catalog of Fal-powered "skills" — capabilities that the studio can
// drive. Each entry maps to a single fal.ai model. Used by /skills (browse
// + launch a new project), the studio toolbar (pick mode + model), and the
// direct generation server fn.

import {
  Image as ImageIcon,
  Video as VideoIcon,
  Music as MusicIcon,
  Mic as MicIcon,
  Users as UsersIcon,
  Mountain as MountainIcon,
  Shirt as ShirtIcon,
  Sofa as SofaIcon,
  Sparkles as SparklesIcon,
  Type as TypeIcon,
  Camera as CameraIcon,
  Package as PackageIcon,
  Palette as PaletteIcon,
  Wand2 as Wand2Icon,
  Eraser as EraserIcon,
  ScanFace as ScanFaceIcon,
  Disc3 as Disc3Icon,
  Megaphone as MegaphoneIcon,
  Headphones as HeadphonesIcon,
  BookOpen as BookOpenIcon,
  Film as FilmIcon,
  Clapperboard as ClapperboardIcon,
  Zap as ZapIcon,
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
  // ── Photo Apps (creative image use-cases) ─────────────────────────
  {
    id: "app-character-swap",
    label: "Character Swap",
    description: "Drop a new character into any scene while keeping pose, lighting, and composition intact.",
    category: "Photo Apps",
    kind: "image",
    model: "fal-ai/nano-banana/edit",
    icon: UsersIcon,
  },
  {
    id: "app-background-swap",
    label: "Background Swap",
    description: "Send your subject anywhere — Tokyo street, studio backdrop, alien planet — in one prompt.",
    category: "Photo Apps",
    kind: "image",
    model: "fal-ai/nano-banana/edit",
    icon: MountainIcon,
  },
  {
    id: "app-outfit-try-on",
    label: "Virtual Try-On",
    description: "Restyle a person in new clothing, accessories, or full looks while preserving identity.",
    category: "Photo Apps",
    kind: "image",
    model: "fal-ai/nano-banana/edit",
    icon: ShirtIcon,
  },
  {
    id: "app-room-redesign",
    label: "Room Re-Designer",
    description: "Re-decorate an interior in a new style — Scandi, brutalist, cottagecore — without moving walls.",
    category: "Photo Apps",
    kind: "image",
    model: "fal-ai/nano-banana/edit",
    icon: SofaIcon,
  },
  {
    id: "app-headshot-studio",
    label: "Headshot Studio",
    description: "Turn a casual selfie into a polished, photoreal LinkedIn-grade portrait.",
    category: "Photo Apps",
    kind: "image",
    model: "fal-ai/flux-pro/v1.1",
    icon: ScanFaceIcon,
  },
  {
    id: "app-glow-up",
    label: "Style Glow-Up",
    description: "Apply a cohesive look — film stock, color grade, lighting mood — across any image.",
    category: "Photo Apps",
    kind: "image",
    model: "fal-ai/nano-banana/edit",
    icon: SparklesIcon,
  },
  {
    id: "app-object-remove",
    label: "Cleanup & Remove",
    description: "Erase tourists, wires, logos, or distractions and let the model fill in the gap cleanly.",
    category: "Photo Apps",
    kind: "image",
    model: "fal-ai/nano-banana/edit",
    icon: EraserIcon,
  },
  {
    id: "app-pet-portrait",
    label: "Pet Hero Portrait",
    description: "Your pet, re-imagined as a Renaissance noble, astronaut, or rockstar.",
    category: "Photo Apps",
    kind: "image",
    model: "fal-ai/flux-pro/v1.1",
    icon: PaletteIcon,
  },

  // ── Marketing Apps (text + product imagery) ───────────────────────
  {
    id: "app-poster-maker",
    label: "Poster Maker",
    description: "Event posters with crisp, legible typography baked right into the image.",
    category: "Marketing Apps",
    kind: "image",
    model: "fal-ai/ideogram/v3",
    icon: TypeIcon,
  },
  {
    id: "app-product-shot",
    label: "Product Hero Shot",
    description: "Studio-grade product photography from a plain catalog image — any lighting, any set.",
    category: "Marketing Apps",
    kind: "image",
    model: "fal-ai/flux-pro/v1.1",
    icon: PackageIcon,
  },
  {
    id: "app-logo-mockup",
    label: "Logo Mockup",
    description: "Slap a logo onto t-shirts, billboards, packaging, or storefronts for instant pitch decks.",
    category: "Marketing Apps",
    kind: "image",
    model: "fal-ai/nano-banana/edit",
    icon: Wand2Icon,
  },
  {
    id: "app-album-cover",
    label: "Album Cover Art",
    description: "Square, high-fidelity cover art with optional title typography baked in.",
    category: "Marketing Apps",
    kind: "image",
    model: "fal-ai/ideogram/v3",
    icon: Disc3Icon,
  },
  {
    id: "app-ad-creative",
    label: "Ad Creative",
    description: "Punchy social ad creative — bold headline, eye-catching visual — in one go.",
    category: "Marketing Apps",
    kind: "image",
    model: "fal-ai/ideogram/v3",
    icon: MegaphoneIcon,
  },
  {
    id: "app-storyboard-frames",
    label: "Storyboard Frames",
    description: "Rapid-fire keyframes for a scene — same characters, same style, different beats.",
    category: "Marketing Apps",
    kind: "image",
    model: "fal-ai/flux/schnell",
    icon: CameraIcon,
  },

  // ── Video Apps (creative video use-cases) ─────────────────────────
  {
    id: "app-animate-photo",
    label: "Animate a Photo",
    description: "Bring a still image to life with subtle motion, parallax, and atmosphere.",
    category: "Video Apps",
    kind: "video",
    model: "fal-ai/kling-video/v2.1/standard/image-to-video",
    icon: ZapIcon,
  },
  {
    id: "app-cinematic-broll",
    label: "Cinematic B-Roll",
    description: "Dreamy, filmic clips you can drop into edits, intros, or mood reels.",
    category: "Video Apps",
    kind: "video",
    model: "fal-ai/luma-dream-machine",
    icon: FilmIcon,
  },
  {
    id: "app-music-video-clip",
    label: "Music Video Clip",
    description: "Short, punchy text-to-video clips perfect for stitching together a music video.",
    category: "Video Apps",
    kind: "video",
    model: "fal-ai/kling-video/v2.1/master/text-to-video",
    icon: ClapperboardIcon,
  },
  {
    id: "app-product-demo-loop",
    label: "Product Demo Loop",
    description: "Looping motion clip of your product spinning, floating, or revealing — from one still.",
    category: "Video Apps",
    kind: "video",
    model: "fal-ai/kling-video/v2.1/standard/image-to-video",
    icon: PackageIcon,
  },
  {
    id: "app-trailer-snippet",
    label: "Trailer Snippet",
    description: "Fast, cinematic text-to-video shots for teaser cuts and concept trailers.",
    category: "Video Apps",
    kind: "video",
    model: "fal-ai/minimax/video-01",
    icon: FilmIcon,
  },

  // ── Audio Apps ────────────────────────────────────────────────────
  {
    id: "app-lofi-beat",
    label: "Lo-Fi Study Beat",
    description: "Chill, loopable lo-fi instrumentals for focus, study, or background ambience.",
    category: "Audio Apps",
    kind: "audio",
    model: "fal-ai/cassetteai/music-generator",
    icon: HeadphonesIcon,
  },
  {
    id: "app-trailer-score",
    label: "Trailer Score",
    description: "Tension-building cinematic score — risers, hits, and orchestral swells.",
    category: "Audio Apps",
    kind: "audio",
    model: "fal-ai/stable-audio",
    icon: Disc3Icon,
  },
  {
    id: "app-sound-fx",
    label: "Sound FX Pack",
    description: "Custom one-shot SFX — whooshes, impacts, ambiences — tailored to your scene.",
    category: "Audio Apps",
    kind: "audio",
    model: "fal-ai/stable-audio",
    icon: ZapIcon,
  },

  // ── Voice Apps ────────────────────────────────────────────────────
  {
    id: "app-audiobook-narrator",
    label: "Audiobook Narrator",
    description: "Long-form, studio-grade narration in expressive natural voices.",
    category: "Voice Apps",
    kind: "speech",
    model: "fal-ai/elevenlabs/tts/multilingual-v2",
    icon: BookOpenIcon,
  },
  {
    id: "app-podcast-host",
    label: "Podcast Host",
    description: "Warm, conversational voiceover ideal for scripted podcast intros and segments.",
    category: "Voice Apps",
    kind: "speech",
    model: "fal-ai/playai/tts/v3",
    icon: MicIcon,
  },
  {
    id: "app-ad-voiceover",
    label: "Ad Voiceover",
    description: "Polished, multilingual ad-read voiceover in dozens of voices.",
    category: "Voice Apps",
    kind: "speech",
    model: "fal-ai/elevenlabs/tts/multilingual-v2",
    icon: MegaphoneIcon,
  },

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
    model: "fal-ai/kling-video/v2.1/master/text-to-video",
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
  video: "fal-ai/kling-video/v2.1/master/text-to-video",
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