import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import symbolLogo from "@/assets/symbol.svg";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { createProject } from "@/lib/projects.functions";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "AI Video Director — Chat your way to a finished video" },
      {
        name: "description",
        content:
          "AI Video Director turns your idea into a complete video — shot images, animated clips, music, voiceover, and a stitched final MP4.",
      },
      { property: "og:title", content: "AI Video Director" },
      {
        property: "og:description",
        content:
          "Chat with an AI director that produces a complete video for you — shots, music, voiceover, and a stitched MP4.",
      },
    ],
  }),
});

function Landing() {
  const navigate = useNavigate();
  const createNew = useServerFn(createProject);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setAuthed(!!data?.user);
    })();
  }, []);

  const startProject = async () => {
    setBusy(true);
    try {
      const { id } = await createNew({ data: {} });
      void navigate({ to: "/studio/$projectId", params: { projectId: id } });
    } catch {
      void navigate({ to: "/projects" });
    } finally {
      setBusy(false);
    }
  };

  if (authed === false) {
    return (
      <main className="relative grid min-h-screen w-full place-items-center bg-background px-6 text-center text-foreground">
        <div className="max-w-xl">
          <img src={symbolLogo} alt="" className="mx-auto mb-8 h-[26px] w-auto brightness-0" />
          <h1 className="font-display text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            AI Video Director
          </h1>
          <p className="mt-5 text-base text-muted-foreground">
            Chat with an AI director that turns your idea into a real video — shot images, animated clips, music, voiceover, stitched MP4.
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
          AI Video Director
        </h1>
        <p className="mt-5 max-w-xl text-base text-muted-foreground">
          Describe a video. Get back a stitched MP4 with shot images, animated clips, original music, and voiceover — all generated for you.
        </p>

        <button
          onClick={startProject}
          disabled={busy || authed === null}
          className="group mt-10 inline-flex items-center gap-3 rounded-full bg-foreground px-7 py-4 text-base font-semibold text-background shadow-elegant transition hover:shadow-glow disabled:opacity-70"
        >
          {busy ? "Opening studio…" : "Start a new project"}
          {!busy && (
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          )}
        </button>

        <Link
          to="/projects"
          className="mt-4 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Or open an existing project
        </Link>
      </section>
    </main>
  );
}
