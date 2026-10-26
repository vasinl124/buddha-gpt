// Past conversations, newest first and grouped by day as in ChatGPT's sidebar. A guest's are kept in
// this browser (PRD §11); an account's in the core, through lib/account.
import type { ChatData } from "@buddha-gpt/shared";
import { generateId, type UIMessage } from "ai";

export type BuddhaMessage = UIMessage<never, ChatData>;

export interface SavedChat {
  id: string;
  title: string; // the first question
  updated: number; // ms since the epoch
  messages?: BuddhaMessage[]; // an account's arrive when the conversation is opened
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY = "buddha-gpt:chats";
const SINGLE = "buddha-gpt:conversation"; // the one conversation kept before there was a history
// ponytail: localStorage holds about 5 MB and a turn with its cards about 9 KB; IndexedDB if people keep more
const MAX = 50;
const DAY = 24 * 60 * 60 * 1000;

const textOf = (m: BuddhaMessage) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");

/** A conversation's name in the list: its first question, on one line. */
export function title(messages: BuddhaMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  const line = (first ? textOf(first) : "").replace(/\s+/g, " ").trim();
  return [...line].slice(0, 80).join("") || "New conversation"; // by character, so an emoji isn't cut in half
}

/** Adds or replaces a conversation, newest first, keeping at most MAX. */
export function upsert(chats: SavedChat[], chat: SavedChat): SavedChat[] {
  return [chat, ...chats.filter((c) => c.id !== chat.id)].sort((a, b) => b.updated - a.updated).slice(0, MAX);
}

/** The sidebar's sections, in order, leaving out empty ones. Days are local, from midnight. */
export function groups(chats: SavedChat[], now: number): { label: string; chats: SavedChat[] }[] {
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const bounds: [string, number][] = [
    ["Today", midnight],
    ["Yesterday", midnight - DAY],
    ["Previous 7 days", midnight - 7 * DAY],
    ["Previous 30 days", midnight - 30 * DAY],
    ["Older", -Infinity],
  ];
  const out = bounds.map(([label]) => ({ label, chats: [] as SavedChat[] }));
  for (const chat of chats) out[bounds.findIndex(([, from]) => chat.updated >= from)].chats.push(chat);
  return out.filter((g) => g.chats.length > 0);
}

// Reading localStorage itself throws where the site may not keep data, so it's read inside the try.

/** The saved conversations. The single conversation saved before there was a history moves in. */
export function load(storage?: Store): SavedChat[] {
  try {
    const store = storage ?? localStorage;
    const chats: SavedChat[] = JSON.parse(store.getItem(KEY) ?? "[]");
    const single: BuddhaMessage[] = JSON.parse(store.getItem(SINGLE) ?? "[]");
    if (!single.length) return chats;
    const moved = upsert(chats, { id: generateId(), title: title(single), updated: Date.now(), messages: single });
    save(moved, store);
    store.removeItem(SINGLE);
    return moved;
  } catch {
    return []; // unreadable or blocked storage: start empty
  }
}

/** Keeps them in this browser. When storage is full the oldest go first, so the newest is still kept. */
export function save(chats: SavedChat[], storage?: Pick<Storage, "setItem">) {
  for (let kept = chats; ; kept = kept.slice(0, -1)) {
    try {
      (storage ?? localStorage).setItem(KEY, JSON.stringify(kept));
      return;
    } catch {
      if (!kept.length) return; // blocked storage: it just isn't kept
    }
  }
}

/** Calls back with the saved conversations whenever another tab changes them, so neither tab's
 * saves drop the other's conversations. Returns the unsubscribe. */
export function watch(onChange: (chats: SavedChat[]) => void): () => void {
  const changed = (e: StorageEvent) => {
    if (e.key === KEY) onChange(load());
  };
  addEventListener("storage", changed);
  return () => removeEventListener("storage", changed);
}
