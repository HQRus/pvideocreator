import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronUp, LogOut } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";

export function AccountPopover() {
  const navigate = useNavigate();
  const [user, setUser] = useState<{
    email: string | null;
    name: string | null;
    avatar: string | null;
  } | null>(null);
  const [busy, setBusy] = useState<null | "logout">(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const u = data?.user;
      if (!u) return;
      const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
      setUser({
        email: u.email ?? null,
        name:
          (typeof meta.full_name === "string" && meta.full_name) ||
          (typeof meta.name === "string" && meta.name) ||
          (u.email ? u.email.split("@")[0] : null),
        avatar:
          (typeof meta.avatar_url === "string" && meta.avatar_url) ||
          (typeof meta.picture === "string" && meta.picture) ||
          null,
      });
    })();
  }, []);

  const handleLogout = async () => {
    setBusy("logout");
    try {
      await supabase.auth.signOut();
      void navigate({ to: "/login" });
    } finally {
      setBusy(null);
    }
  };

  if (!user) return null;

  const initials = (user.name ?? user.email ?? "?")
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  return (
    <div className="fixed bottom-4 left-4 z-50">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-3 rounded-3xl bg-card px-3 py-2 pr-2 shadow-elegant backdrop-blur-xl transition hover:bg-card/80"
          >
            <Avatar className="h-9 w-9">
              {user.avatar ? <AvatarImage src={user.avatar} alt="" /> : null}
              <AvatarFallback>{initials || "U"}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col items-start leading-tight">
              <span className="text-sm font-medium text-foreground">
                {user.name ?? user.email}
              </span>
              {user.email && (
                <span className="text-xs text-muted-foreground">
                  {user.email}
                </span>
              )}
            </div>
            <ChevronUp className="ml-2 h-4 w-4 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          className="w-64 p-2"
        >
          <div className="px-2 py-2 border-b border-border mb-1">
            <p className="text-sm font-medium truncate">
              {user.name ?? "Account"}
            </p>
            {user.email && (
              <p className="text-xs text-muted-foreground truncate">
                {user.email}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            className="w-full justify-start gap-2 text-destructive hover:text-destructive"
            disabled={busy !== null}
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            {busy === "logout" ? "Logging out…" : "Log out"}
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}