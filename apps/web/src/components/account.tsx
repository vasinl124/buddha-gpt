"use client";

import { LogOutIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { enter, type User } from "@/lib/account";

interface AccountProps {
  user: User | null;
  onSignIn: (user: User) => Promise<void>;
  onSignOut: () => void;
}

// The foot of the sidebar: where the conversations are kept, and signing in or out. Signing up says
// plainly that they'll be kept on the server, since they can touch on health and belief (PRD §11).
export function Account({ user, onSignIn, onSignOut }: AccountProps) {
  const [mode, setMode] = useState<"closed" | "login" | "signup">("closed");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (user) {
    return (
      <div className="flex items-center gap-2.5 px-2 pb-1">
        <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-medium uppercase">
          {user.username[0]}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{user.username}</p>
          <p className="text-xs text-muted-foreground">Kept in your account</p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Sign out" title="Sign out" onClick={onSignOut}>
          <LogOutIcon />
        </Button>
      </div>
    );
  }

  if (mode === "closed") {
    return (
      <div className="flex flex-col gap-2 px-2 pb-1">
        <p className="text-xs text-muted-foreground">Kept in this browser only.</p>
        <Button variant="outline" size="sm" onClick={() => setMode("login")}>
          Sign in to keep them anywhere
        </Button>
      </div>
    );
  }

  const signup = mode === "signup";
  const field = "flex flex-col gap-1 text-xs text-muted-foreground";
  return (
    <form
      className="flex flex-col gap-2.5 px-2 pb-1"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setPending(true);
        setError("");
        try {
          await onSignIn(await enter(mode, String(form.get("username")), String(form.get("password"))));
        } catch (err) {
          setError((err as Error).message);
          setPending(false);
        }
      }}
    >
      <label className={field}>
        Username
        <Input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus />
      </label>
      <label className={field}>
        Password
        <Input
          name="password"
          type="password"
          autoComplete={signup ? "new-password" : "current-password"}
          minLength={signup ? 8 : undefined}
          required
        />
      </label>
      {signup && (
        <p className="text-xs text-muted-foreground">
          Your conversations will be kept on this app&apos;s server, under your account, so you can open them anywhere. You can delete any of them.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        {signup ? "Create account" : "Sign in"}
      </Button>
      <div className="flex justify-between text-xs text-muted-foreground">
        <button
          type="button"
          className="underline-offset-4 hover:text-foreground hover:underline"
          onClick={() => {
            setMode(signup ? "login" : "signup");
            setError("");
          }}
        >
          {signup ? "I have an account" : "Create an account"}
        </button>
        <button type="button" className="underline-offset-4 hover:text-foreground hover:underline" onClick={() => setMode("closed")}>
          Cancel
        </button>
      </div>
    </form>
  );
}
