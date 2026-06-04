import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createProject } from "@/lib/projects.functions";
import { SKILLS, SKILL_CATEGORIES, type Skill } from "@/lib/skills";

export const Route = createFileRoute("/_authenticated/apps")({
  component: SkillsPage,
});

function SkillsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createNew = useServerFn(createProject);

  const launchMut = useMutation({
    mutationFn: (skill: Skill) =>
      createNew({
        data: {
          title: skill.label,
          skill: skill.id,
          studioMode: skill.kind,
          studioModel: skill.model,
        },
      }),
    onSuccess: ({ id }) => {
      void queryClient.invalidateQueries({ queryKey: ["projects-list"] });
      void navigate({ to: "/studio/$projectId", params: { projectId: id } });
    },
  });

  return (
    <main className="min-h-screen w-full px-8 py-12 text-foreground">
      <div className="mx-auto max-w-6xl">
        <header className="mb-10">
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            Skills
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Pick a generative skill — image, video, music, or speech — and
            we'll spin up a fresh project tuned to it. Every skill is powered
            by Fal.
          </p>
        </header>

        {SKILL_CATEGORIES.map((cat) => {
          const items = SKILLS.filter((s) => s.category === cat);
          return (
            <section key={cat} className="mb-12">
              <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {cat}
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((s) => {
                  const Icon = s.icon;
                  const pending =
                    launchMut.isPending &&
                    (launchMut.variables as Skill | undefined)?.id === s.id;
                  return (
                    <button
                      key={s.id}
                      disabled={launchMut.isPending}
                      onClick={() => launchMut.mutate(s)}
                      className="group flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-5 text-left transition hover:border-primary/50 hover:shadow-glow disabled:opacity-60"
                    >
                      <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-gradient text-primary-foreground shadow-glow">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="text-lg font-semibold tracking-tight">
                        {s.label}
                      </div>
                      <div className="text-sm leading-relaxed text-muted-foreground">
                        {s.description}
                      </div>
                      <div className="mt-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60">
                        {pending ? "launching…" : s.model}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}