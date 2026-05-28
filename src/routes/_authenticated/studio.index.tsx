import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/studio/")({
  beforeLoad: () => {
    throw redirect({ to: "/projects" });
  },
});