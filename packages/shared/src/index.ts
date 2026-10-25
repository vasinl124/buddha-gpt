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

/** The custom parts the agent streams with a reply (AI SDK UI message data parts). A type, not an
 * interface: the AI SDK needs an index signature here. */
export type ChatData = {
  cards: Card[];
  notice: string; // e.g. "mock model": shown above the reply
};

/** How the model marks a citation in its reply text: [[cite:sn56.11#en5]]. */
export const CITE = /\[\[cite:([^\]\s]+)\]\]/g;
