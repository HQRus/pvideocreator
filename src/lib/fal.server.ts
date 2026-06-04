// Thin server-side helper for calling fal.ai's queue API.
//
// fal exposes a uniform queue contract across every model:
//   1. POST https://queue.fal.run/<model>            → { request_id, status_url, response_url }
//   2. GET  <status_url>                              → { status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" }
//   3. GET  <response_url>                            → model-specific result body
//
// We poll until COMPLETED (or fail/timeout) and return the parsed response.
// All authentication uses the FAL_KEY secret as `Authorization: Key <FAL_KEY>`.

export type FalRunOptions = {
  /** Total time before we give up polling. Defaults to 10 minutes. */
  timeoutMs?: number;
  /** Poll interval. Defaults to 3s. */
  intervalMs?: number;
  /** Optional label for log lines. */
  label?: string;
};

const DEFAULT_TIMEOUT = 10 * 60_000;
const DEFAULT_INTERVAL = 3_000;

function requireKey(): string {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("Missing FAL_KEY");
  return key;
}

function authHeader(): Record<string, string> {
  return { Authorization: `Key ${requireKey()}` };
}

/**
 * Submit a job to a fal model and poll until completion. Returns the model's
 * parsed JSON response body on success, throws on failure or timeout.
 */
export async function falRun<T = unknown>(
  model: string,
  input: Record<string, unknown>,
  opts: FalRunOptions = {},
): Promise<T> {
  const label = opts.label ?? model;
  const submitRes = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader(),
    },
    body: JSON.stringify(input),
  });
  if (!submitRes.ok) {
    const txt = await submitRes.text().catch(() => "");
    throw new Error(`fal ${label} submit ${submitRes.status}: ${txt.slice(0, 500)}`);
  }
  const submitted = (await submitRes.json()) as {
    request_id?: string;
    status_url?: string;
    response_url?: string;
  };
  const statusUrl = submitted.status_url;
  const responseUrl = submitted.response_url;
  if (!statusUrl || !responseUrl) {
    throw new Error(`fal ${label} submit returned no status_url/response_url`);
  }

  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT);
  const interval = opts.intervalMs ?? DEFAULT_INTERVAL;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    const sRes = await fetch(statusUrl, { headers: authHeader() });
    if (!sRes.ok) {
      // Transient — keep polling unless we've burned the budget.
      continue;
    }
    const sJson = (await sRes.json().catch(() => ({}))) as {
      status?: string;
      logs?: unknown;
    };
    const status = (sJson.status || "").toUpperCase();
    if (status === "COMPLETED") {
      const rRes = await fetch(responseUrl, { headers: authHeader() });
      if (!rRes.ok) {
        const txt = await rRes.text().catch(() => "");
        throw new Error(`fal ${label} response ${rRes.status}: ${txt.slice(0, 500)}`);
      }
      return (await rRes.json()) as T;
    }
    if (status === "FAILED" || status === "CANCELLED" || status === "ERROR") {
      throw new Error(`fal ${label} job ${status.toLowerCase()}`);
    }
  }
  throw new Error(`fal ${label} timed out after ${(opts.timeoutMs ?? DEFAULT_TIMEOUT) / 1000}s`);
}

// ─── Output sweepers ────────────────────────────────────────────────────────
// fal models differ slightly in their response shape — sometimes
// `{ image: { url } }`, `{ images: [{ url }] }`, `{ video: { url } }`,
// `{ audio: { url } }`, etc. These walk the response and pull out the first
// URL of the expected media kind.

const URL_RE = /https?:\/\/[^\s"'<>)]+/g;

function sweep(out: unknown, predicate: (url: string) => boolean): string[] {
  const found = new Set<string>();
  const visit = (v: unknown) => {
    if (!v) return;
    if (typeof v === "string") {
      const m = v.match(URL_RE);
      if (m) for (const u of m) if (predicate(u)) found.add(u);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (typeof v === "object") {
      for (const val of Object.values(v as Record<string, unknown>)) visit(val);
    }
  };
  visit(out);
  return Array.from(found);
}

export function falPickImageUrl(out: unknown): string | null {
  const urls = sweep(
    out,
    (u) =>
      /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(u) ||
      // fal serves results from fal.media — accept those even without extension.
      /fal\.media|fal\.run|fal-ai|r2\.cloudflarestorage/i.test(u),
  );
  // Prefer ones with image extensions if both kinds appear.
  const withExt = urls.filter((u) => /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(u));
  return withExt[0] ?? urls.find((u) => !/\.(mp3|wav|mp4|mov|webm|m4a)(\?|$)/i.test(u)) ?? null;
}

export function falPickVideoUrl(out: unknown): string | null {
  const urls = sweep(
    out,
    (u) =>
      /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u) ||
      /fal\.media|fal\.run|fal-ai/i.test(u),
  );
  const withExt = urls.filter((u) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u));
  return withExt[0] ?? urls[0] ?? null;
}

export function falPickAudioUrl(out: unknown): string | null {
  const urls = sweep(
    out,
    (u) =>
      /\.(mp3|wav|m4a|ogg|flac)(\?|$)/i.test(u) ||
      /fal\.media|fal\.run|fal-ai/i.test(u),
  );
  const withExt = urls.filter((u) => /\.(mp3|wav|m4a|ogg|flac)(\?|$)/i.test(u));
  return withExt[0] ?? urls[0] ?? null;
}

// ─── Convenience wrappers ───────────────────────────────────────────────────

/** Normalize an aspect string like "9:16" / "16:9" / "1:1". */
export function normalizeAspect(raw: string | undefined | null): "16:9" | "9:16" | "1:1" {
  if (!raw) return "16:9";
  const m = raw.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (!m) return "16:9";
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (Math.abs(w - h) < 0.01) return "1:1";
  return w > h ? "16:9" : "9:16";
}

/**
 * Generate an image. Uses nano-banana — text-to-image when no reference
 * URLs are provided, edit (i.e. multi-image conditioning for likeness) when
 * any are.
 */
export async function falGenerateImage(args: {
  prompt: string;
  aspect?: string;
  referenceImageUrls?: string[];
}): Promise<string> {
  const refs = (args.referenceImageUrls ?? []).filter((u) => /^https?:/.test(u));
  const aspect = normalizeAspect(args.aspect);
  if (refs.length === 0) {
    const out = await falRun("fal-ai/nano-banana", {
      prompt: args.prompt,
      aspect_ratio: aspect,
      num_images: 1,
    }, { label: "nano-banana" });
    const url = falPickImageUrl(out);
    if (!url) throw new Error("nano-banana returned no image URL");
    return url;
  }
  const out = await falRun("fal-ai/nano-banana/edit", {
    prompt: args.prompt,
    image_urls: refs,
    aspect_ratio: aspect,
    num_images: 1,
  }, { label: "nano-banana/edit" });
  const url = falPickImageUrl(out);
  if (!url) throw new Error("nano-banana/edit returned no image URL");
  return url;
}

/** Animate a still image into a video clip with a motion prompt. */
export async function falAnimateImage(args: {
  prompt: string;
  imageUrl: string;
  durationSeconds: number;
  aspect?: string;
}): Promise<string> {
  // Kling i2v expects duration in seconds, but only "5" or "10" are supported.
  const dur = args.durationSeconds <= 6 ? "5" : "10";
  const out = await falRun(
    "fal-ai/kling-video/v2.1/standard/image-to-video",
    {
      prompt: args.prompt,
      image_url: args.imageUrl,
      duration: dur,
      aspect_ratio: normalizeAspect(args.aspect),
    },
    { label: "kling-i2v", timeoutMs: 15 * 60_000 },
  );
  const url = falPickVideoUrl(out);
  if (!url) throw new Error("kling-i2v returned no video URL");
  return url;
}

/** Generate a music bed of approximately the requested length. */
export async function falGenerateMusic(args: {
  prompt: string;
  durationSeconds: number;
}): Promise<string> {
  const dur = Math.max(10, Math.min(180, Math.round(args.durationSeconds)));
  const out = await falRun(
    "fal-ai/cassetteai/music-generator",
    { prompt: args.prompt, duration: dur },
    { label: "music-generator" },
  );
  const url = falPickAudioUrl(out);
  if (!url) throw new Error("music-generator returned no audio URL");
  return url;
}

/** Generate a voiceover line via ElevenLabs (through fal). */
export async function falGenerateVoiceover(args: {
  text: string;
  voice?: string;
}): Promise<string> {
  const out = await falRun(
    "fal-ai/elevenlabs/tts/multilingual-v2",
    {
      text: args.text,
      voice: args.voice ?? "Rachel",
    },
    { label: "elevenlabs-tts" },
  );
  const url = falPickAudioUrl(out);
  if (!url) throw new Error("elevenlabs-tts returned no audio URL");
  return url;
}

/**
 * Stitch per-shot video clips together, layer music underneath, and overlay
 * per-shot voiceover lines at their scene offsets. Returns the URL of the
 * final composed MP4.
 */
export async function falStitchFilm(args: {
  clips: Array<{ url: string; durationSeconds: number }>;
  musicUrl?: string;
  voiceovers?: Array<{ url: string; startSeconds: number; durationSeconds: number }>;
}): Promise<string> {
  let cursor = 0;
  const videoKeyframes = args.clips.map((c) => {
    const kf = {
      url: c.url,
      timestamp: cursor,
      duration: c.durationSeconds,
    };
    cursor += c.durationSeconds;
    return kf;
  });
  const totalDuration = cursor;

  const tracks: Array<Record<string, unknown>> = [
    {
      id: "video-track",
      type: "video",
      keyframes: videoKeyframes,
    },
  ];
  if (args.musicUrl) {
    tracks.push({
      id: "music-track",
      type: "audio",
      keyframes: [
        {
          url: args.musicUrl,
          timestamp: 0,
          duration: totalDuration,
          volume: 0.4,
        },
      ],
    });
  }
  if (args.voiceovers?.length) {
    tracks.push({
      id: "vo-track",
      type: "audio",
      keyframes: args.voiceovers.map((v) => ({
        url: v.url,
        timestamp: v.startSeconds,
        duration: v.durationSeconds,
        volume: 1,
      })),
    });
  }

  const out = await falRun(
    "fal-ai/ffmpeg-api/compose",
    { tracks },
    { label: "ffmpeg-compose", timeoutMs: 15 * 60_000 },
  );
  const url = falPickVideoUrl(out);
  if (!url) throw new Error("ffmpeg-compose returned no video URL");
  return url;
}