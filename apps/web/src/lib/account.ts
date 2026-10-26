// An account and the conversations it keeps, through the agent (PRD §8.6). The session is an
// HttpOnly cookie the agent sets, so every call sends credentials.
import type { BuddhaMessage, SavedChat } from "@/lib/history";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:7891";

export interface User {
  username: string;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "That didn't work. Try again.");
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Who's signed in here: null for a guest, and when the agent can't be reached. */
export const whoami = () => call<{ user: User }>("/api/auth/me").then((r) => r.user, () => null);

export const enter = (mode: "login" | "signup", username: string, password: string) =>
  call<{ user: User }>(`/api/auth/${mode}`, { method: "POST", body: JSON.stringify({ username, password }) }).then((r) => r.user);

export const leave = () => call<void>("/api/auth/logout", { method: "POST" });

/** The account's conversations, newest first, without their messages. */
export const listChats = () => call<{ chats: SavedChat[] }>("/api/chats").then((r) => r.chats);

export const openChat = (id: string) =>
  call<{ chat: { messages: BuddhaMessage[] } }>(`/api/chats/${encodeURIComponent(id)}`).then((r) => r.chat.messages);

export const putChat = (chat: SavedChat) =>
  call<void>(`/api/chats/${encodeURIComponent(chat.id)}`, { method: "PUT", body: JSON.stringify(chat) });

export const deleteChat = (id: string) => call<void>(`/api/chats/${encodeURIComponent(id)}`, { method: "DELETE" });
