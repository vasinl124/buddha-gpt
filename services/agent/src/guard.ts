// The guard (PRD §6): one small structured-output call that routes the turn and rewrites the latest
// message into a search query that stands on its own. Crisis keywords are checked in code as well,
// and either one routes to crisis.
import { readFileSync } from "node:fs";
import { generateText, Output, type ModelMessage } from "ai";
import { z } from "zod";
import { fold } from "./checks.ts";
import { guardModel } from "./model.ts";
import { policy } from "./policy.ts";

const PROMPT = readFileSync(new URL("../../../prompts/guard.md", import.meta.url), "utf8");
const TURNS = 5; // the latest message and the two exchanges before it

const topics = Object.keys(policy.decline) as [string, ...string[]];

export const Guard = z.object({
  route: z.enum(["crisis", "decline", "redirect", "chat", "answer"]),
  decline_topic: z.enum(topics).nullable(),
  search_query: z.string(),
  quote: z.string(), // words the person attributes to the Buddha, or ""
});
export type Guard = z.infer<typeof Guard>;
export type Route = Guard["route"];

/** True when the text contains one of policy.yaml's crisis phrases. */
export function crisisKeyword(text: string): boolean {
  const t = fold(text);
  return policy.crisis.keywords.some((k) => t.includes(fold(k)));
}

/** Routes the turn. Never throws: on any failure it answers, and the crisis keywords still apply. */
export async function guard(messages: ModelMessage[], latest: string): Promise<Guard> {
  const model = guardModel();
  if (!model) return mockGuard(latest);
  const recent = messages.slice(-TURNS);
  while (recent[0]?.role === "assistant") recent.shift(); // the call has to start with the user
  try {
    // no reasoning: routing doesn't need it, and some providers refuse thinking with a forced schema
    const { output } = await generateText({
      model,
      instructions: PROMPT,
      messages: recent,
      output: Output.object({ schema: Guard }),
      maxOutputTokens: 500, // a few short fields
      abortSignal: AbortSignal.timeout(15_000),
    });
    return output;
  } catch (err) {
    console.error("guard:", err);
    return { route: "answer", decline_topic: null, search_query: latest, quote: "" };
  }
}

// No key: a keyword stand-in, so the routes can be tried, and tested, before a key exists.
function mockGuard(latest: string): Guard {
  const t = fold(latest);
  const quote = latest.match(/(?:buddha (?:really )?(?:say|said)|ตรัสว่า)[,:]?\s*["“']([^"”']+)["”']/i)?.[1] ?? "";
  const guess = (route: Route, decline_topic: string | null = null): Guard => ({ route, decline_topic, search_query: latest, quote });
  if (/lottery|lotto|หวย|เลขเด็ด/.test(t)) return guess("decline", "lottery");
  if (/^(hi|hello|hey|thanks|thank you)\b|^(สวัสดี|ขอบคุณ)/.test(t)) return guess("chat");
  return guess("answer");
}
