import DOMPurify from "isomorphic-dompurify";
import { useEffect, useRef } from "react";
import type { AssetKind, ProjectAsset } from "@/lib/project-state";

const SANITIZE_CONFIG = {
  ADD_ATTR: [
    "data-card",
    "data-card-title",
    "data-action",
    "data-value",
    "data-pill",
    "data-upload",
    "data-capture",
    "data-kind",
    "data-asset-ref",
    "data-reorder",
    "data-compare",
    "data-bind",
    "data-min",
    "data-max",
    "data-step",
    "data-unit",
    "data-format",
    "accept",
    "capture",
    "multiple",
    "min",
    "max",
    "step",
    "type",
    "value",
    "checked",
    "controls",
    "playsinline",
    "muted",
    "loop",
    "autoplay",
  ],
  ADD_TAGS: ["img", "audio", "video", "source"],
  FORBID_TAGS: ["script", "style", "link", "iframe", "object", "embed"],
  FORBID_ATTR: ["style", "onclick", "onsubmit", "onload", "onerror"],
  // Allow blob:, https:, http:, data:image, plus tel/mailto for completeness.
  // The default DOMPurify regex rejects blob: which we need for in-browser uploads.
  ALLOWED_URI_REGEXP:
    /^(?:(?:blob|https?|mailto|tel):|data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml);|#|\/)/i,
};

export function extractCardTitle(html: string): string {
  const m = html.match(/data-card-title=["']([^"']+)["']/);
  return m ? m[1] : "Card";
}

// Pulls the conversational AI prose out of the card so it can be rendered
// in the chat history rather than inside the interactive surface.
// The model is instructed to put it in <p data-prose>…</p>.
export function extractCardProse(html: string): string {
  const m = html.match(/<p[^>]*data-prose[^>]*>([\s\S]*?)<\/p>/i);
  if (!m) return "";
  return m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

export function stripCardProse(html: string): string {
  return html.replace(/<p[^>]*data-prose[^>]*>[\s\S]*?<\/p>/i, "");
}

export function stripCardWrapper(html: string): string {
  // strip a leading ```html fence or stray text the model may emit
  const fence = html.match(/```(?:html)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const start = html.indexOf("<div");
  if (start > 0) return html.slice(start);
  return html;
}

// Extract a hidden JSON project patch the model embeds in its reply.
// Shape:
//   <script type="application/json" data-project-patch>{ ... }</script>
// We always strip these out of the HTML before sanitizing/rendering.
export function extractProjectPatch(html: string): unknown | null {
  const m = html.match(
    /<script[^>]*data-project-patch[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!m) return null;
  try {
    return JSON.parse(m[1].trim());
  } catch {
    return null;
  }
}

export function stripProjectPatch(html: string): string {
  return html.replace(
    /<script[^>]*data-project-patch[^>]*>[\s\S]*?<\/script>/gi,
    "",
  );
}

// ---------- Typed answer collection ----------

export type CardAnswer = {
  summary: string;
  assets: ProjectAsset[];
};

type LiveAsset = ProjectAsset; // identical for now

const KIND_LABEL: Record<AssetKind, string> = {
  likeness: "selfie / likeness",
  logo: "logo",
  reference: "reference",
  voice: "voice sample",
  audio: "audio",
  video: "video clip",
  other: "file",
};

function inferKind(el: HTMLElement, file: File): AssetKind {
  const dk = (el.getAttribute("data-kind") || "").toLowerCase();
  if (dk && dk in KIND_LABEL) return dk as AssetKind;
  if (file.type.startsWith("image/")) return "reference";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  return "other";
}

async function probeMedia(
  url: string,
  mime: string,
): Promise<Pick<ProjectAsset, "width" | "height" | "duration">> {
  return new Promise((resolve) => {
    if (mime.startsWith("image/")) {
      const img = new Image();
      img.onload = () =>
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({});
      img.src = url;
      return;
    }
    if (mime.startsWith("audio/") || mime.startsWith("video/")) {
      const el = document.createElement(
        mime.startsWith("audio/") ? "audio" : "video",
      ) as HTMLMediaElement;
      el.preload = "metadata";
      el.onloadedmetadata = () => {
        const out: Pick<ProjectAsset, "width" | "height" | "duration"> = {
          duration: isFinite(el.duration) ? Math.round(el.duration) : undefined,
        };
        if ("videoWidth" in el) {
          const v = el as HTMLVideoElement;
          if (v.videoWidth) {
            out.width = v.videoWidth;
            out.height = v.videoHeight;
          }
        }
        resolve(out);
      };
      el.onerror = () => resolve({});
      el.src = url;
      return;
    }
    resolve({});
  });
}

let _aid = 0;
const nextAssetId = () => `ast_${Date.now().toString(36)}${(++_aid).toString(36)}`;

async function fileToAsset(
  file: File,
  source: HTMLElement,
): Promise<LiveAsset> {
  const url = URL.createObjectURL(file);
  const meta = await probeMedia(url, file.type);
  return {
    id: nextAssetId(),
    kind: inferKind(source, file),
    mime: file.type || "application/octet-stream",
    name: file.name,
    url,
    label: source.getAttribute("data-value") || undefined,
    ...meta,
  };
}

function describeAsset(a: LiveAsset): string {
  const kindLabel = KIND_LABEL[a.kind] ?? "file";
  const dims =
    a.width && a.height
      ? ` ${a.width}×${a.height}`
      : a.duration
        ? ` ${a.duration}s`
        : "";
  return `${kindLabel}: ${a.name}${dims} [${a.id}]`;
}

function fieldLabel(input: HTMLElement, name: string): string {
  // Try aria-label, placeholder, the parent <label>'s first <span>, or fall back to name.
  const aria = input.getAttribute("aria-label");
  if (aria) return aria;
  const placeholder = (input as HTMLInputElement).placeholder;
  if (placeholder) return placeholder;
  const label = input.closest("label");
  const spanText = label?.querySelector("span")?.textContent?.trim();
  if (spanText) return spanText;
  return name;
}

function coerceValue(
  input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
): unknown {
  if (input instanceof HTMLSelectElement && input.multiple) {
    return Array.from(input.selectedOptions).map((o) => o.value);
  }
  if (input instanceof HTMLInputElement) {
    if (input.type === "checkbox") return input.checked;
    if (input.type === "number" || input.type === "range") {
      const n = input.valueAsNumber;
      return Number.isFinite(n) ? n : input.value;
    }
    if (input.type === "date" || input.type === "datetime-local" || input.type === "time") {
      return input.value; // ISO-ish
    }
  }
  return input.value;
}

export function GenerativeCard({
  html,
  onAnswer,
  disabled,
  assets,
}: {
  html: string;
  onAnswer: (answer: CardAnswer) => void;
  disabled?: boolean;
  assets?: ProjectAsset[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cleaned = stripProjectPatch(stripCardProse(stripCardWrapper(html)));
  const safe = DOMPurify.sanitize(cleaned, SANITIZE_CONFIG);

  useEffect(() => {
    const root = ref.current;
    if (root && assets && assets.length) {
      // Swap any <img data-asset-ref="ast_xxx"> placeholders the model
      // emits for real blob URLs from project state.
      const map = new Map(assets.map((a) => [a.id, a]));
      root
        .querySelectorAll<HTMLImageElement>("img[data-asset-ref]")
        .forEach((img) => {
          const a = map.get(img.getAttribute("data-asset-ref") || "");
          if (a) {
            img.src = a.url;
            img.alt = a.name;
          }
        });
    }
    if (!root || disabled) return;

    // Track files attached to inputs in this card (form not yet submitted).
    const pendingFiles = new WeakMap<HTMLInputElement, LiveAsset[]>();

    const renderPreviewFor = (input: HTMLInputElement, assets: LiveAsset[]) => {
      // Find or create a preview strip next to the file input.
      let strip = input.parentElement?.querySelector<HTMLElement>(
        '[data-card-preview="1"]',
      );
      if (!strip) {
        strip = document.createElement("div");
        strip.setAttribute("data-card-preview", "1");
        strip.className =
          "mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground";
        input.parentElement?.appendChild(strip);
      }
      strip.innerHTML = "";
      for (const a of assets) {
        const wrap = document.createElement("div");
        wrap.className =
          "flex items-center gap-2 rounded-2xl border border-border bg-muted/40 p-2 pr-3";
        if (a.mime.startsWith("image/")) {
          const img = document.createElement("img");
          img.src = a.url;
          img.className = "h-12 w-12 rounded-xl object-cover";
          wrap.appendChild(img);
        } else {
          const dot = document.createElement("div");
          dot.className =
            "grid h-12 w-12 place-items-center rounded-xl bg-muted text-muted-foreground";
          dot.textContent = a.mime.startsWith("audio/")
            ? "♪"
            : a.mime.startsWith("video/")
              ? "▶"
              : "•";
          wrap.appendChild(dot);
        }
        const name = document.createElement("span");
        name.className = "max-w-[180px] truncate text-foreground";
        name.textContent = a.name;
        wrap.appendChild(name);
        strip.appendChild(wrap);
      }
    };

    const handleFileChange = async (e: Event) => {
      const input = e.target as HTMLInputElement;
      if (input.tagName !== "INPUT" || input.type !== "file") return;
      const list = input.files;
      if (!list || list.length === 0) return;
      const assets: LiveAsset[] = [];
      for (const f of Array.from(list)) {
        assets.push(await fileToAsset(f, input));
      }
      pendingFiles.set(input, assets);
      renderPreviewFor(input, assets);

      // Standalone (not inside a form, no submit button next to it) →
      // auto-submit so a single file picker = a single answer.
      const standalone = !input.closest("form");
      if (standalone) {
        const title = input.getAttribute("data-value") || "Uploaded";
        onAnswer({
          summary: assets.map(describeAsset).join("; "),
          assets,
        });
      }
    };

    const startCapture = async (btn: HTMLElement) => {
      const mode = btn.getAttribute("data-capture") || "camera";
      const wantVideo = mode === "camera";
      try {
        const stream = await navigator.mediaDevices.getUserMedia(
          wantVideo ? { video: true, audio: false } : { audio: true },
        );
        if (wantVideo) {
          // Single-shot photo capture.
          const video = document.createElement("video");
          video.srcObject = stream;
          video.muted = true;
          await video.play();
          await new Promise((r) => setTimeout(r, 300));
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          canvas.getContext("2d")?.drawImage(video, 0, 0);
          stream.getTracks().forEach((t) => t.stop());
          const blob: Blob | null = await new Promise((r) =>
            canvas.toBlob(r, "image/jpeg", 0.92),
          );
          if (!blob) return;
          const file = new File([blob], `capture-${Date.now()}.jpg`, {
            type: "image/jpeg",
          });
          const asset = await fileToAsset(file, btn);
          onAnswer({ summary: describeAsset(asset), assets: [asset] });
        } else {
          // Audio capture — record until user clicks again.
          const rec = new MediaRecorder(stream);
          const chunks: BlobPart[] = [];
          rec.ondataavailable = (ev) => chunks.push(ev.data);
          rec.onstop = async () => {
            stream.getTracks().forEach((t) => t.stop());
            const blob = new Blob(chunks, { type: "audio/webm" });
            const file = new File([blob], `voice-${Date.now()}.webm`, {
              type: "audio/webm",
            });
            const asset = await fileToAsset(file, btn);
            asset.kind = "voice";
            onAnswer({ summary: describeAsset(asset), assets: [asset] });
          };
          rec.start();
          btn.textContent = "Stop recording";
          btn.setAttribute("data-recording", "1");
          const stopHandler = () => {
            btn.removeEventListener("click", stopHandler);
            rec.stop();
          };
          btn.addEventListener("click", stopHandler, { once: true });
        }
      } catch (err) {
        console.error("Capture failed", err);
        onAnswer({
          summary: "Capture unavailable on this device.",
          assets: [],
        });
      }
    };

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const cap = target.closest<HTMLElement>('[data-capture]');
      if (cap) {
        e.preventDefault();
        if (cap.getAttribute("data-recording") === "1") return; // stop handled
        void startCapture(cap);
        return;
      }
      const btn = target.closest<HTMLElement>('[data-action="answer"]');
      if (!btn || btn.tagName !== "BUTTON") return;
      // Inside a form, only intercept explicit type="button" controls
      // (e.g. "You decide for me"). Real submit buttons fall through to
      // the form submit handler below.
      if (btn.closest("form") && (btn as HTMLButtonElement).type !== "button") return;
      e.preventDefault();
      const value =
        btn.getAttribute("data-value") ?? btn.textContent?.trim() ?? "";
      if (value) onAnswer({ summary: value, assets: [] });
    };

    const handleSubmit = (e: Event) => {
      const form = e.target as HTMLFormElement;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.getAttribute("data-action") !== "answer") return;
      e.preventDefault();
      const pairs: string[] = [];
      const assets: LiveAsset[] = [];
      const seen = new Map<string, unknown[]>();
      // First: pick up every file input in the form, named or not, so an
      // upload always reaches the answer payload.
      form.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach((c) => {
        const list = pendingFiles.get(c) || [];
        if (list.length) assets.push(...list);
      });
      const controls = form.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >("input[name], select[name], textarea[name]");
      controls.forEach((c) => {
        const name = c.name;
        if (!name) return;
        if (c instanceof HTMLInputElement && c.type === "file") {
          // already collected above; just surface ids under the named field
          const list = pendingFiles.get(c) || [];
          if (list.length) {
            const arr = seen.get(name) || [];
            for (const a of list) arr.push(a.id);
            seen.set(name, arr);
          }
          return;
        }
        if (c instanceof HTMLInputElement && (c.type === "checkbox" || c.type === "radio")) {
          if (!c.checked) return;
          const arr = seen.get(name) || [];
          arr.push(c.value || true);
          seen.set(name, arr);
          return;
        }
        const val = coerceValue(c);
        const arr = seen.get(name) || [];
        if (Array.isArray(val)) arr.push(...val);
        else arr.push(val);
        seen.set(name, arr);
      });
      for (const [name, vals] of seen) {
        const label = (() => {
          const el = form.querySelector(`[name="${CSS.escape(name)}"]`);
          return el instanceof HTMLElement ? fieldLabel(el, name) : name;
        })();
        const printable = vals
          .map((v) => {
            if (typeof v === "string") return v;
            if (typeof v === "number") return String(v);
            if (typeof v === "boolean") return v ? "yes" : "no";
            return JSON.stringify(v);
          })
          .filter((s) => s !== "" && s !== "null")
          .join(", ");
        if (printable) pairs.push(`${label}: ${printable}`);
      }
      if (assets.length) {
        pairs.push(
          `attached — ${assets.map(describeAsset).join("; ")}`,
        );
      }
      onAnswer({
        summary: pairs.length ? pairs.join(" · ") : "Submitted",
        assets,
      });
    };

    root.addEventListener("click", handleClick);
    root.addEventListener("submit", handleSubmit);
    root.addEventListener("change", handleFileChange);
    return () => {
      root.removeEventListener("click", handleClick);
      root.removeEventListener("submit", handleSubmit);
      root.removeEventListener("change", handleFileChange);
    };
  }, [onAnswer, disabled, safe]);

  return (
    <div
      ref={ref}
      className="generative-card animate-card-pop w-full rounded-3xl border border-border bg-card p-6 text-base leading-relaxed shadow-elegant sm:p-8"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}

export function DecisionPill({
  title,
  answer,
}: {
  title: string;
  answer: string;
}) {
  return (
    <div className="ml-auto flex max-w-[80%] animate-pill-land flex-col gap-1.5 self-end rounded-3xl bg-secondary px-5 py-3.5 text-foreground shadow-elegant">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </span>
      <span className="text-base leading-snug">{answer}</span>
    </div>
  );
}

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="ml-auto max-w-[80%] animate-pill-land rounded-3xl bg-secondary px-5 py-3.5 text-base leading-snug text-foreground shadow-elegant">
      {text}
    </div>
  );
}

export function AssistantMessage({ text }: { text: string }) {
  return (
    <div className="max-w-[85%] animate-fade-in self-start font-display text-2xl leading-snug tracking-tight text-foreground">
      {text}
    </div>
  );
}