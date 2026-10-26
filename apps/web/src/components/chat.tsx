"use client";

import { useChat } from "@ai-sdk/react";
import { CITE, type Crisis } from "@buddha-gpt/shared";
import { DefaultChatTransport, generateId } from "ai";
import { ArrowUpIcon, PhoneIcon, RotateCcwIcon, SquareIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { AnimateOptions } from "streamdown";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Suggestion } from "@/components/ai-elements/suggestion";
import { History } from "@/components/history";
import { SourceCards } from "@/components/source-cards";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Frame, Mark } from "@/components/top-bar";
import { load, save, title, upsert, watch, type BuddhaMessage, type SavedChat } from "@/lib/history";
import { quotesToThaiScript, toThaiScript } from "@/lib/pali";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:7891";
const STARTERS = ["What is suffering?", "How do I stop being angry?", "My father died last month", "ทุกข์คืออะไร"];
// Thai in a turn shows its Pali in Thai script, as Thai editions print it; otherwise it's Roman
const THAI = /[฀-๿]/;
// the agent releases a reply a sentence at a time: its words fade in as they arrive
const WORDS: AnimateOptions = { animation: "blurIn", duration: 300, easing: "var(--ease-out-quart)" };
const ENTER = "animate-in fade-in-0 duration-300 ease-out-quart";
// While he gathers his words: goodwill from the Mettā Sutta (Snp 1.8), verbatim from VRI's Pali,
// with a plain gloss. Only wishes for the person's good, since the line shows before the agent knows
// whether the message is a crisis; a crisis turn's dot has no words at all.
const BLESSINGS = [
  { pi: "Sabbasattā bhavantu sukhitattā", en: "may all beings be happy at heart", th: "ขอสัตว์ทั้งปวงจงมีความสุขเถิด" },
  { pi: "Sukhino va khemino hontu", en: "may they be happy and safe", th: "ขอให้เป็นสุข มีความเกษมเถิด" },
  { pi: "Mettañca sabbalokasmi", en: "goodwill for the whole world", th: "เมตตาไปทั่วทั้งโลก" },
];

// The conversations kept in this browser (PRD §11): the sidebar lists them and the chat shows one. The
// chat is keyed by its conversation, so opening another starts it afresh with that one's messages.
export function Chat() {
  const [chats, setChats] = useState<SavedChat[]>(() => load());
  const [current, setCurrent] = useState(() => chats[0]?.id ?? generateId());
  const [busy, setBusy] = useState(false);
  const unsaved = !chats.some((c) => c.id === current); // a new conversation: nothing to start over from

  useEffect(() => save(chats), [chats]);
  useEffect(() => watch(setChats), []); // another tab saved: take its list

  // called as a question goes out and as its reply ends, never on every streamed word
  const keep = useCallback(
    (messages: BuddhaMessage[]) => {
      if (!messages.length) return;
      setChats((all) => {
        const kept = all.find((c) => c.id === current)?.messages;
        // nothing new, as when a conversation is only opened: it keeps its place in the list
        if (kept?.length === messages.length && kept.at(-1)?.id === messages.at(-1)?.id) return all;
        return upsert(all, { id: current, title: title(messages), updated: Date.now(), messages });
      });
    },
    [current],
  );
  const fresh = () => setCurrent(generateId());
  const remove = (id: string) => {
    setChats((all) => all.filter((c) => c.id !== id));
    if (id === current) fresh();
  };

  return (
    <Frame
      sidebar={<History chats={chats} current={current} disabled={busy} onOpen={setCurrent} onNew={fresh} onDelete={remove} />}
      onNew={busy || unsaved ? undefined : fresh}
    >
      <ChatBody key={current} initial={chats.find((c) => c.id === current)?.messages ?? []} onChange={keep} onBusy={setBusy} />
    </Frame>
  );
}

interface ChatBodyProps {
  initial: BuddhaMessage[];
  onChange: (messages: BuddhaMessage[]) => void;
  onBusy: (busy: boolean) => void;
}

function ChatBody({ initial, onChange, onBusy }: ChatBodyProps) {
  const [input, setInput] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const { messages, sendMessage, status, error, stop, regenerate } = useChat<BuddhaMessage>({
    messages: initial,
    transport: new DefaultChatTransport({ api: `${API}/api/chat` }),
  });
  const busy = status === "submitted" || status === "streaming";
  // a conversation saved from an earlier visit shows at once; only new messages move
  const [saved] = useState(() => new Set(messages.map((m) => m.id)));
  const last = messages.at(-1);
  // the agent holds a reply until its first cited sentence, so the first words can take a while
  const waiting = busy && !(last?.role === "assistant" && textOf(last).trim());

  useEffect(() => {
    if (status !== "streaming") onChange(messages);
  }, [messages, status, onChange]);
  useEffect(() => onBusy(busy), [busy, onBusy]);

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    sendMessage({ text });
    setInput("");
    // a starter's button disappears once asked: the follow-up goes in the box. Not on touch
    // screens, where focus opens the keyboard over the reply
    if (matchMedia("(pointer: fine)").matches) box.current?.focus();
  };

  // An empty conversation starts in the middle of the page; once there's a question, the input moves
  // to the bottom. The form keeps its place among the children, so it stays mounted and focused.
  const empty = messages.length === 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {empty ? (
        <Welcome />
      ) : (
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="px-0">
            {messages.map((m, i) => (
              <Turn
                key={m.id}
                message={m}
                question={messages[i - 1]}
                fresh={!saved.has(m.id)}
                streaming={status === "streaming" && m === last}
                waiting={waiting && m === last}
              />
            ))}
            {waiting && last?.role === "user" && (
              <Message from="assistant" className={ENTER}>
                <MessageContent>
                  <Pending thai={THAI.test(textOf(last))} seed={last.id} />
                </MessageContent>
              </Message>
            )}
            {error && (
              <div role="alert" className={`flex flex-wrap items-center gap-3 text-sm text-destructive ${ENTER}`}>
                The reply didn’t arrive.
                <Button variant="outline" size="sm" onClick={() => regenerate()}>
                  <RotateCcwIcon />
                  Try again
                </Button>
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <InputGroup className="bg-card shadow-sm">
          <InputGroupTextarea
            ref={box}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              } else if (e.key === "Escape" && busy) stop();
            }}
            placeholder="Ask in English or Thai, or ask for the Pali…"
            maxLength={2000}
            aria-label="Your message"
            autoFocus
          />
          <InputGroupAddon align="block-end" className="justify-end">
            {busy ? (
              <InputGroupButton type="button" variant="default" size="icon-sm" onClick={() => stop()} aria-label="Stop">
                <SquareIcon className="size-3 fill-current" />
              </InputGroupButton>
            ) : (
              <InputGroupButton type="submit" variant="default" size="icon-sm" disabled={!input.trim()} aria-label="Send">
                <ArrowUpIcon />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </form>
      {empty && (
        <div className="mb-auto flex flex-wrap justify-center gap-2">
          {STARTERS.map((s) => (
            <Suggestion key={s} suggestion={s} onClick={send} />
          ))}
        </div>
      )}
      <p className="text-center text-xs text-muted-foreground">
        An AI reflecting on the Pali Canon, not the Buddha himself. Only the sources under each reply quote the texts.
      </p>
    </div>
  );
}

// The empty page: who you're talking to, and how to begin.
function Welcome() {
  return (
    <div className={`mt-auto flex flex-col items-center gap-3 pb-3 text-center ${ENTER}`}>
      <Mark className="size-10 text-chart-3" />
      <h2 className="font-serif text-2xl text-balance">Ask about the Dhamma, or about what weighs on you.</h2>
      <p className="text-sm text-muted-foreground">A conversation with the Buddha where every quote is real.</p>
    </div>
  );
}

const textOf = (m?: BuddhaMessage) => (m?.parts ?? []).map((p) => (p.type === "text" ? p.text : "")).join("");

interface TurnProps {
  message: BuddhaMessage;
  question?: BuddhaMessage; // the message this one answers
  fresh: boolean; // sent in this visit, so it moves in
  streaming: boolean; // its words are arriving
  waiting: boolean; // its first words haven't arrived yet
}

function Turn({ message, question, fresh, streaming, waiting }: TurnProps) {
  const text = textOf(message);
  if (message.role === "user") {
    return (
      <Message from="user" className={fresh ? `${ENTER} slide-in-from-bottom-2` : undefined}>
        <MessageContent>{text}</MessageContent>
      </Message>
    );
  }
  const cards = message.parts.flatMap((p) => (p.type === "data-cards" ? p.data : []));
  const notice = message.parts.find((p) => p.type === "data-notice")?.data;
  const crisis = message.parts.find((p) => p.type === "data-crisis")?.data;
  const pali = message.parts.some((p) => p.type === "data-pali"); // Pali mode: the text is the canon's own words
  const thaiScript = THAI.test(text) || THAI.test(textOf(question));
  if (!text.trim() && !waiting && !cards.length && !crisis) return null; // stopped before its first words
  const enter = fresh ? ENTER : undefined;
  return (
    <Message from="assistant">
      <MessageContent className="w-full">
        {notice && (
          <Badge variant="outline" className="w-fit">
            {notice}
          </Badge>
        )}
        {waiting ? (
          <Pending thai={thaiScript} seed={question?.id ?? message.id} quiet={!!crisis} />
        ) : (
          // his words in the serif: the app's own chrome stays in the sans
          <div lang={pali ? "pi" : undefined} className="font-serif text-base leading-7">
            <MessageResponse components={{ a: ReplyLink }} animated={WORDS} isAnimating={streaming}>
              {stripCitations(pali && thaiScript ? quotesToThaiScript(text) : text)}
            </MessageResponse>
          </div>
        )}
        {crisis && <Hotlines crisis={crisis} className={enter} />}
        <SourceCards cards={cards} thaiScript={thaiScript} className={enter} />
      </MessageContent>
    </Message>
  );
}

// Holds a reply's place until its first words arrive: a breath before he speaks, and a line of
// goodwill, never words about searching. The question's id picks the line, so it stays put while the
// placeholder moves into the reply.
function Pending({ thai, seed, quiet = false }: { thai: boolean; seed: string; quiet?: boolean }) {
  const line = BLESSINGS[[...seed].reduce((n, c) => n + c.charCodeAt(0), 0) % BLESSINGS.length];
  return (
    <div role="status" className="flex min-h-7 items-start gap-2.5">
      <span aria-hidden className="mt-2.5 size-2 shrink-0 animate-breathe rounded-full bg-primary" />
      {!quiet && (
        <p aria-hidden className="flex flex-col">
          <span lang="pi" className={`font-serif text-[0.9375rem] leading-7 text-foreground/75 ${thai ? "" : "italic"}`}>
            {thai ? toThaiScript(line.pi) : line.pi}
          </span>
          <span className="text-xs text-muted-foreground">{thai ? line.th : line.en}</span>
        </p>
      )}
      <span className="sr-only">{thai ? "กำลังตอบ" : "Replying"}</span>
    </div>
  );
}

// The numbers come from policy.yaml through the agent, never from the model (PRD §6).
function Hotlines({ crisis, className }: { crisis: Crisis; className?: string }) {
  return (
    <Alert className={className}>
      <PhoneIcon />
      <AlertTitle>{crisis.title}</AlertTitle>
      <AlertDescription>
        <ul className="flex flex-col gap-1">
          {crisis.lines.map((line) => (
            <li key={line.label}>
              {line.number ? (
                <a href={`tel:${line.number}`} className="font-medium text-foreground">
                  {line.number}
                </a>
              ) : (
                <a href={line.url} target="_blank" rel="noreferrer">
                  {line.url?.replace(/^https?:\/\//, "")}
                </a>
              )}{" "}
              {line.label}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

// The reply reads as plain speech: its [[cite:…]] markers, and the space before each, are dropped.
// The passages they point at are under the reply, in Sources.
const CITE_AND_SPACE = new RegExp(String.raw`\s*${CITE.source}`, "g");
const stripCitations = (text: string) => text.replace(CITE_AND_SPACE, "");

// A link in a reply opens in a new tab. Streamdown types its link props loosely, so href is checked.
function ReplyLink(props: { href?: unknown; children?: unknown; node?: unknown }) {
  return (
    <a href={typeof props.href === "string" ? props.href : undefined} target="_blank" rel="noreferrer">
      {props.children as ReactNode}
    </a>
  );
}
