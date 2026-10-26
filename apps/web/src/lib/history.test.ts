import assert from "node:assert/strict";
import { test } from "node:test";
import { groups, load, save, title, upsert, type BuddhaMessage, type SavedChat } from "./history";

const say = (role: "user" | "assistant", text: string, id = role): BuddhaMessage => ({ id, role, parts: [{ type: "text", text }] });
const chat = (id: string, updated: number): SavedChat => ({ id, title: id, updated, messages: [] });

test("a conversation is named by its first question", () => {
  assert.equal(title([say("user", "  What is\n suffering?  "), say("assistant", "Birth is suffering.")]), "What is suffering?");
  assert.equal(title([]), "New conversation");
  assert.equal(title([say("user", "🙏".repeat(100))]), "🙏".repeat(80));
});

test("upsert keeps the newest first, replaces by id, and keeps at most 50", () => {
  const chats = upsert(upsert([chat("a", 1), chat("b", 2)], chat("a", 3)), chat("c", 0));
  assert.deepEqual(chats.map((c) => c.id), ["a", "b", "c"]);
  const many = Array.from({ length: 60 }, (_, i) => chat(`x${i}`, i)).reduce(upsert, [] as SavedChat[]);
  assert.equal(many.length, 50);
  assert.equal(many[0].id, "x59");
});

test("groups by local day, as in ChatGPT, leaving out empty sections", () => {
  const now = new Date(2026, 9, 25, 15).getTime();
  const at = (days: number) => new Date(2026, 9, 25 - days, 9).getTime();
  const chats = [chat("today", at(0)), chat("yesterday", at(1)), chat("week", at(3)), chat("old", at(90))];
  assert.deepEqual(
    groups(chats, now).map((g) => [g.label, g.chats.map((c) => c.id)]),
    [["Today", ["today"]], ["Yesterday", ["yesterday"]], ["Previous 7 days", ["week"]], ["Older", ["old"]]],
  );
});

test("the single conversation saved before there was a history moves in once", () => {
  const store = new Map([["buddha-gpt:conversation", JSON.stringify([say("user", "ทุกข์คืออะไร")])]]);
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const chats = load(storage);
  assert.equal(chats.length, 1);
  assert.equal(chats[0].title, "ทุกข์คืออะไร");
  assert.equal(store.has("buddha-gpt:conversation"), false);
  assert.equal(load(storage).length, 1); // and only once
});

test("when storage is full the oldest conversations go first, and blocked storage is skipped", () => {
  const chats = [chat("new", 3), chat("mid", 2), chat("old", 1)];
  const limit = JSON.stringify(chats.slice(0, 2)).length;
  const store = new Map<string, string>();
  save(chats, {
    setItem: (k: string, v: string) => {
      if (v.length > limit) throw new DOMException("full", "QuotaExceededError");
      store.set(k, v);
    },
  });
  assert.deepEqual(JSON.parse(store.get("buddha-gpt:chats") ?? "[]").map((c: SavedChat) => c.id), ["new", "mid"]);
  const blocked = () => {
    throw new DOMException("denied", "SecurityError");
  };
  assert.doesNotThrow(() => save(chats, { setItem: blocked }));
  assert.deepEqual(load({ getItem: blocked, setItem: blocked, removeItem: blocked }), []);
});
