import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AccountPopover } from "@/components/account-popover";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    // Session is persisted in localStorage only, so it never exists on the
    // server. Running the gate during SSR causes an infinite redirect loop
    // between /projects and /login. Defer to the client.
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getUser();
    if (!data?.user) {
      throw redirect({
        to: "/login",
        search: { redirect: location.href },
      });
    }
  },
  component: () => (
    <>
      <Outlet />
      <AccountPopover />
    </>
  ),
});