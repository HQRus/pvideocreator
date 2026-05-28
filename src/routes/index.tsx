import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import symbolLogo from "@/assets/symbol.svg";
import { supabase } from "@/integrations/supabase/client";
import { fetchWithAuth } from "@/lib/fetch-with-auth";
import { useServerFn } from "@tanstack/react-start";
import { createProject } from "@/lib/projects.functions";

export const Route = createFileRoute("/")({
  component: ConnectGate,
  head: () => ({
    meta: [
      { title: "AI Video Director — Connect Pika to start creating" },
      {
        name: "description",
        content:
          "AI Video Director is an AI video studio powered by Pika. Connect your Pika account to start generating cinematic clips with a director-grade chat workflow.",
      },
      { property: "og:title", content: "AI Video Director — Connect Pika to start creating" },
      {
        property: "og:description",
        content:
          "Connect Pika and step into a generative video studio built around your story.",
      },
    ],
  }),
});

type Status = "loading" | "disconnected" | "connecting" | "ready" | "error";

function ConnectGate() {
  const navigate = useNavigate();
  const createNew = useServerFn(createProject);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const goToNewProject = async () => {
    try {
      const { id } = await createNew({ data: {} });
      void navigate({ to: "/studio/$projectId", params: { projectId: id } });
    } catch {
      void navigate({ to: "/projects" });
    }
  };

  const refresh = async () => {
    try {
      const r = await fetchWithAuth("/api/pika/status");
      const j = (await r.json()) as { state?: string };
      if (j.state === "ready") {
        setStatus("ready");
        void goToNewProject();
      } else {
        setStatus("disconnected");
      }
    } catch {
      setStatus("error");
      setError("Couldn't reach the connection service. Try again in a moment.");
    }
  };

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data?.user) {
        setAuthed(false);
        return;
      }
      setAuthed(true);
      void refresh();
    })();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const onConnect = async () => {
    setStatus("connecting");
    setError(null);
    try {
      const r = await fetchWithAuth("/api/pika/connect", { method: "POST" });
      const j = (await r.json()) as { state?: string; authUrl?: string };
      if (j.state === "ready") {
        setStatus("ready");
        void goToNewProject();
        return;
      }
      if (j.authUrl) {
        window.open(j.authUrl, "_blank", "noopener,noreferrer");
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
          try {
            const s = await fetchWithAuth("/api/pika/status").then(
              (r) => r.json() as Promise<{ state?: string }>,
            );
            if (s.state === "ready") {
              if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
              }
              setStatus("ready");
              void goToNewProject();
            }
          } catch {
            /* keep polling */
          }
        }, 2000);
      } else {
        setStatus("error");
        setError("Pika didn't return an authorization URL. Please retry.");
      }
    } catch {
      setStatus("error");
      setError("Couldn't start the Pika connection. Please retry.");
    }
  };

  const label =
    status === "loading"
      ? "Checking connection…"
      : status === "connecting"
        ? "Waiting for Pika authorization…"
        : status === "ready"
          ? "Opening studio…"
          : "Connect Pika MCP";

  const disabled = status === "loading" || status === "connecting" || status === "ready";

  if (authed === false) {
    return (
      <main className="relative grid min-h-screen w-full place-items-center bg-background px-6 text-center text-foreground">
        <div className="max-w-xl">
          <img src={symbolLogo} alt="" className="mx-auto mb-8 h-[26px] w-auto brightness-0" />
          <h1 className="font-display text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            AI Video Director
          </h1>
          <p className="mt-5 text-base text-muted-foreground">
            Chat with an AI director that turns your idea into a real video — keyframes, clips, music, stitched MP4.
          </p>
          <Link
            to="/login"
            className="mt-8 inline-flex items-center gap-3 rounded-full bg-foreground px-7 py-4 text-base font-semibold text-background shadow-elegant hover:shadow-glow"
          >
            Sign in to start <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/3 h-[60vmin] w-[60vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-gradient opacity-30 blur-3xl" />
      </div>

      <header className="flex h-20 items-center px-8" />

      <section className="mx-auto flex max-w-3xl flex-col items-center px-6 pt-0 text-center">
        <img
          src={symbolLogo}
          alt="AI Video Director symbol"
          className="my-16 h-[26px] w-auto brightness-0"
        />
        <h1 className="font-display text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          AI Video Director Prototype
        </h1>

        <button
          onClick={onConnect}
          disabled={disabled}
          className="group mt-10 inline-flex items-center gap-3 rounded-full bg-foreground px-7 py-4 text-base font-semibold text-background shadow-elegant transition hover:shadow-glow disabled:opacity-70"
        >
          {label}
          {!disabled && (
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          )}
        </button>

        {error && (
          <p className="mt-4 text-sm text-destructive">{error}</p>
        )}

        <p className="mt-6 text-xs text-muted-foreground">
          We'll open Pika in a new tab so you can authorize access. Tokens stay
          on the server.
        </p>
      </section>
    </main>
  );
}
