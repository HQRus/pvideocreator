import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Film, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  listProjects,
  createProject,
  deleteProject,
} from "@/lib/projects.functions";

export const Route = createFileRoute("/_authenticated/projects")({
  component: ProjectsPage,
});

function ProjectsPage() {
  const navigate = useNavigate();
  const fetchList = useServerFn(listProjects);
  const createNew = useServerFn(createProject);
  const remove = useServerFn(deleteProject);
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: ["projects-list"],
    queryFn: () => fetchList(),
  });
  const createMut = useMutation({
    mutationFn: () => createNew({ data: {} }),
    onSuccess: ({ id }) => {
      void queryClient.invalidateQueries({ queryKey: ["projects-list"] });
      void navigate({ to: "/studio/$projectId", params: { projectId: id } });
    },
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["projects-list"] }),
  });
  const projects = q.data?.projects ?? [];

  return (
    <main className="min-h-screen w-full bg-background px-8 py-12 text-foreground">
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 flex items-end justify-between">
          <div>
            <h1 className="font-display text-4xl font-semibold tracking-tight">
              Your projects
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Pick up where you left off, or start something new.
            </p>
          </div>
          <Button
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending}
            className="rounded-full"
          >
            <Plus className="h-4 w-4" /> New project
          </Button>
        </div>

        {q.isLoading && (
          <div className="text-sm text-muted-foreground">Loading…</div>
        )}
        {!q.isLoading && projects.length === 0 && (
          <div className="rounded-3xl border border-dashed border-border bg-card/40 p-12 text-center">
            <Film className="mx-auto h-8 w-8 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">No projects yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first project to start chatting with the director.
            </p>
            <Button
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending}
              className="mt-6 rounded-full"
            >
              <Plus className="h-4 w-4" /> New project
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <div
              key={p.id}
              className="group relative overflow-hidden rounded-2xl border border-border bg-card transition hover:border-primary/50 hover:shadow-glow"
            >
              <Link
                to="/studio/$projectId"
                params={{ projectId: p.id }}
                className="block"
              >
                <div className="grid aspect-video w-full place-items-center bg-brand-gradient text-primary-foreground">
                  <Film className="h-8 w-8" />
                </div>
                <div className="p-4">
                  <div className="truncate text-base font-semibold">
                    {p.title}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {p.sceneCount} shot{p.sceneCount === 1 ? "" : "s"} · updated{" "}
                    {new Date(p.updatedAt).toLocaleDateString()}
                  </div>
                </div>
              </Link>
              <button
                onClick={() => {
                  if (confirm(`Delete "${p.title}"? This cannot be undone.`))
                    deleteMut.mutate(p.id);
                }}
                aria-label="Delete project"
                className="absolute right-2 top-2 hidden h-8 w-8 place-items-center rounded-full bg-background/80 text-muted-foreground hover:text-destructive group-hover:grid"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}