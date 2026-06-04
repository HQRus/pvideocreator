import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listLibrary } from "@/lib/library.functions";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, ImageIcon, Film, Music2, Mic, Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/library")({
  component: LibraryPage,
});

function LibraryPage() {
  const fetchLib = useServerFn(listLibrary);
  const q = useQuery({
    queryKey: ["library"],
    queryFn: () => fetchLib(),
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });

  // Refetch whenever any render_job row changes for this user.
  useEffect(() => {
    const channel = supabase
      .channel("library-jobs")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "render_jobs" },
        () => {
          void q.refetch();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = q.data ?? { references: [], generations: [], queue: [] };

  return (
    <main className="min-h-screen w-full px-8 py-12 text-foreground">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8">
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            My Library
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Every reference you've uploaded and every clip you've generated,
            in one place. New renders show up live.
          </p>
        </header>

        {data.queue.length > 0 && (
          <section className="mb-10 rounded-3xl border border-border bg-card/60 p-5">
            <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Queue ·{" "}
              {data.queue.length} active
            </div>
            <ul className="flex flex-col gap-2">
              {data.queue.map((j) => (
                <li
                  key={j.id}
                  className="flex items-center justify-between rounded-2xl bg-muted/40 px-4 py-3"
                >
                  <Link
                    to="/studio/$projectId"
                    params={{ projectId: j.projectId }}
                    className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                  >
                    {j.projectTitle}
                  </Link>
                  <span className="ml-3 rounded-full bg-amber-400/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-500">
                    {j.status}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <Tabs defaultValue="generations">
          <TabsList className="mb-6">
            <TabsTrigger value="generations">
              Generations ({data.generations.length})
            </TabsTrigger>
            <TabsTrigger value="references">
              References ({data.references.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="generations" className="m-0">
            <AssetGrid
              empty="No generations yet — head to Apps to make your first."
              items={data.generations}
            />
          </TabsContent>
          <TabsContent value="references" className="m-0">
            <AssetGrid
              empty="No uploaded references yet. Upload one from inside a project."
              items={data.references}
            />
          </TabsContent>
        </Tabs>

        {q.isLoading && (
          <div className="mt-8 text-sm text-muted-foreground">Loading…</div>
        )}
      </div>
    </main>
  );
}

type Item = {
  id: string;
  projectId: string;
  projectTitle: string;
  kind: string;
  mime: string;
  name: string;
  url: string;
  label: string | null;
  createdAt: string;
};

function AssetGrid({ items, empty }: { items: Item[]; empty: string }) {
  if (items.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-border bg-card/40 p-12 text-center text-sm text-muted-foreground">
        {empty}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((it) => (
        <AssetCard key={it.id} item={it} />
      ))}
    </div>
  );
}

function AssetCard({ item }: { item: Item }) {
  const isImage = item.mime.startsWith("image/");
  const isVideo = item.mime.startsWith("video/");
  const isAudio = item.mime.startsWith("audio/");
  return (
    <div className="group overflow-hidden rounded-2xl border border-border bg-card">
      <div className="relative aspect-square bg-muted">
        {isImage && (
          <img
            src={item.url}
            alt={item.label ?? item.name}
            className="h-full w-full object-cover"
          />
        )}
        {isVideo && (
          <video
            src={item.url}
            muted
            loop
            playsInline
            preload="metadata"
            onMouseEnter={(e) =>
              void (e.currentTarget as HTMLVideoElement).play().catch(() => {})
            }
            onMouseLeave={(e) => (e.currentTarget as HTMLVideoElement).pause()}
            className="h-full w-full object-cover"
          />
        )}
        {isAudio && (
          <div className="grid h-full w-full place-items-center text-muted-foreground">
            <Music2 className="h-10 w-10" />
          </div>
        )}
        {!isImage && !isVideo && !isAudio && (
          <div className="grid h-full w-full place-items-center text-muted-foreground">
            <ImageIcon className="h-10 w-10" />
          </div>
        )}
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          download={item.name}
          className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-background/80 text-muted-foreground opacity-0 backdrop-blur transition group-hover:opacity-100 hover:text-foreground"
          aria-label="Download"
        >
          <Download className="h-3.5 w-3.5" />
        </a>
        <span className="absolute left-2 top-2 rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
          {item.kind}
        </span>
      </div>
      <div className="p-3">
        <div className="truncate text-sm font-medium" title={item.label ?? item.name}>
          {item.label ?? item.name}
        </div>
        <Link
          to="/studio/$projectId"
          params={{ projectId: item.projectId }}
          className="mt-0.5 block truncate text-xs text-muted-foreground hover:underline"
        >
          {item.projectTitle}
        </Link>
      </div>
    </div>
  );
}

// Use a friendlier set of icons in the tab labels.
void Film;
void Mic;