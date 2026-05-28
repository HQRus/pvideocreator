import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronUp, LogOut, Zap, Plug } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { fetchWithAuth } from "@/lib/fetch-with-auth";

export function AccountPopover() {
  const navigate = useNavigate();
  const [user, setUser] = useState<{
    email: string | null;
    name: string | null;
    avatar: string | null;
  } | null>(null);
  const [pikaState, setPikaState] = useState<string>("loading");
  const [busy, setBusy] = useState<null | "logout" | "reconnect">(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    void refreshStatus();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const refreshStatus = async () => {
    try {
      const r = await fetchWithAuth("/api/pika/status");
      const j = (await r.json()) as { state?: string };
      setPikaState(j.state ?? "disconnected");
    } catch {
      setPikaState("error");
    }
  };

  const handleLogout = async () => {
    setBusy("logout");
    try {
      await supabase.auth.signOut();
      void navigate({ to: "/login" });
    } finally {
      setBusy(null);
    }
  };

  const handleReconnect = async () => {
    setBusy("reconnect");
    try {
      await fetchWithAuth("/api/pika/disconnect", { method: "POST" });
      const r = await fetchWithAuth("/api/pika/connect", { method: "POST" });
      const j = (await r.json()) as { state?: string; authUrl?: string };
      if (j.state === "ready") {
        setPikaState("ready");
        return;
      }
      if (j.authUrl) {
        window.open(j.authUrl, "_blank", "noopener,noreferrer");
        setPikaState("authenticating");
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
          try {
            const s = await fetchWithAuth("/api/pika/status").then(
              (res) => res.json() as Promise<{ state?: string }>,
            );
            if (s.state === "ready") {
              if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
              }
              setPikaState("ready");
            }
          } catch {
            /* keep polling */
          }
        }, 2000);
      }
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

  const pikaLabel =
    pikaState === "ready"
      ? "Connected"
      : pikaState === "authenticating"
        ? "Waiting for Pika…"
        : pikaState === "loading"
          ? "Checking…"
          : "Disconnected";

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
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Zap className="h-3 w-3" />
                {pikaLabel}
              </span>
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
            className="w-full justify-start gap-2"
            disabled={busy !== null}
            onClick={handleReconnect}
          >
            <Plug className="h-4 w-4" />
            {busy === "reconnect" ? "Reconnecting…" : "Reconnect Pika"}
          </Button>
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