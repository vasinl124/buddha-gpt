"use client";

import { useChat } from "@ai-sdk/react";
import { CITE, type ChatData, type Crisis } from "@buddha-gpt/shared";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowUpIcon, PhoneIcon, RotateCcwIcon, SquareIcon, SquarePenIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { AnimateOptions } from "streamdown";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { SourceCards } from "@/components/source-cards";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { quotesToThaiScript } from "@/lib/pali";

type BuddhaMessage = UIMessage<never, ChatData>;

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:7891";
// the conversation lives in this browser only (PRD §11)
const SAVED = "buddha-gpt:conversation";
const STARTERS = ["What is suffering?", "How do I stop being angry?", "My father died last month", "ทุกข์คืออะไร"];
// Thai in a turn shows its Pali in Thai script, as Thai editions print it; otherwise it's Roman
const THAI = /[฀-๿]/;
// the agent releases a reply a sentence at a time: its words fade in as they arrive
const WORDS: AnimateOptions = { animation: "blurIn", duration: 300, easing: "var(--ease-out-quart)" };
const ENTER = "animate-in fade-in-0 duration-300 ease-out-quart";

function load<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode or full storage: it just isn't kept
  }
}

export function Chat() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, setMessages, status, error, stop, regenerate } = useChat<BuddhaMessage>({
    messages: load(SAVED, []),
    transport: new DefaultChatTransport({ api: `${API}/api/chat` }),
  });
  const busy = status === "submitted" || status === "streaming";
  // a conversation saved from an earlier visit shows at once; only new messages move
  const [saved] = useState(() => new Set(messages.map((m) => m.id)));
  const last = messages.at(-1);
  // the agent holds a reply until its first cited sentence, so the first words can take a while
  const waiting = busy && !(last?.role === "assistant" && textOf(last).trim());

  useEffect(() => save(SAVED, messages), [messages]);

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    sendMessage({ text });
    setInput("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Conversation className="min-h-0 flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState>
              <p className="text-muted-foreground">Ask about the Dhamma, or about what weighs on you.</p>
              <Suggestions>
                {STARTERS.map((s) => (
                  <Suggestion key={s} suggestion={s} onClick={send} />
                ))}
              </Suggestions>
            </ConversationEmptyState>
          ) : (
            messages.map((m, i) => (
              <Turn
                key={m.id}
                message={m}
                question={messages[i - 1]}
                fresh={!saved.has(m.id)}
                streaming={status === "streaming" && m === last}
                waiting={waiting && m === last}
              />
            ))
          )}
          {waiting && last?.role === "user" && (
            <Message from="assistant" className={ENTER}>
              <MessageContent>
                <Pending thai={THAI.test(textOf(last))} />
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

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <InputGroup>
          <InputGroupTextarea
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
          <InputGroupAddon align="block-end" className="justify-end gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <InputGroupButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy || messages.length === 0}
                  onClick={() => setMessages([])}
                  aria-label="New conversation"
                >
                  <SquarePenIcon />
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>New conversation</TooltipContent>
            </Tooltip>
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
      <p className="text-center text-xs text-muted-foreground">
        An AI reflecting on the Pali Canon, not the Buddha himself. Only the sources under each reply quote the texts.
      </p>
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
          // a crisis turn shows its hotlines at once and searches nothing, so its dot has no words
          <Pending thai={thaiScript} quiet={!!crisis} />
        ) : (
          <div lang={pali ? "pi" : undefined}>
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

// Holds a reply's place until its first words arrive.
function Pending({ thai, quiet = false }: { thai: boolean; quiet?: boolean }) {
  return (
    <p role="status" className="flex h-6 items-center gap-2.5 text-sm text-muted-foreground">
      <span aria-hidden className="size-2 animate-breathe rounded-full bg-primary" />
      {quiet ? <span className="sr-only">Replying</span> : thai ? "กำลังค้นพระสูตร…" : "Searching the canon…"}
    </p>
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
