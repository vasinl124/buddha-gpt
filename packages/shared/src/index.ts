// Types shared by the web app and the agent. Add a type here only when both sides use it.

export type Status = "up" | "down" | "unknown";

/** GET /healthz on the agent: the agent itself, the Go core, and Postgres as the core sees it. */
export interface AgentHealth {
  ok: true;
  core: Status;
  db: Status;
}

/** Source languages: Pali, Thai, English. */
export type Lang = "pi" | "th" | "en";

/** The reply language the browser asks for: auto-detected Thai or English, either forced, or
 * Pali mode, where the reply is the canon's own words (PRD §5.1). */
export type ReplyLang = "auto" | "en" | "th" | "pi";

/** One cited paragraph, filled verbatim from the database by the Go core (POST /v1/cards). */
export interface Card {
  id: string; // the cited paragraph: "sn56.11#en5"
  sutta_id: string; // "sn56.11"
  collection: string;
  title_pi?: string;
  title_en?: string;
  /** The paragraph in each language whose paragraphs line up with the cited one. */
  texts: Partial<Record<Lang, string>>;
  /** A short sutta's whole text, in a language whose paragraphs don't line up. */
  whole?: Partial<Record<Lang, string>>;
}

/** The hotlines under a crisis reply, from policy.yaml: the model never writes a number. */
export interface Crisis {
  title: string;
  lines: { label: string; number?: string; url?: string }[];
}

/** The custom parts the agent streams with a reply (AI SDK UI message data parts). A type, not an
 * interface: the AI SDK needs an index signature here. */
export type ChatData = {
  cards: Card[];
  notice: string; // e.g. "mock model": shown above the reply
  crisis: Crisis;
  risk: true; // this conversation showed risk; the browser sends it back with later turns (PRD §9)
  pali: true; // the reply is Pali quoted verbatim (Pali mode)
};

/** How the model marks a citation in its reply text: [[cite:sn56.11#en5]]. */
export const CITE = /\[\[cite:([^\]\s]+)\]\]/g;
