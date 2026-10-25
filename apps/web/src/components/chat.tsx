"use client";

import { useChat } from "@ai-sdk/react";
import { CITE, type ChatData, type Crisis, type ReplyLang } from "@buddha-gpt/shared";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowUpIcon, PhoneIcon, SquarePenIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
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
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { quotesToThaiScript } from "@/lib/pali";
import { cardAnchor } from "@/lib/refs";

type BuddhaMessage = UIMessage<never, ChatData>;

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:7891";
// the conversation and the settings live in this browser only (PRD §11)
const SAVED = { conversation: "buddha-gpt:conversation", lang: "buddha-gpt:lang", thaiScript: "buddha-gpt:thai-script" };
const STARTERS = ["What is suffering?", "How do I stop being angry?", "My father died last month", "ทุกข์คืออะไร"];
const REPLY_LANGS: [ReplyLang, string][] = [["auto", "Auto"], ["en", "EN"], ["th", "ไทย"], ["pi", "Pāli"]];

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
  const [lang, setLang] = useState<ReplyLang>(() => load(SAVED.lang, "auto"));
  const [thaiScript, setThaiScript] = useState(() => load(SAVED.thaiScript, false));
  const { messages, sendMessage, setMessages, status, error } = useChat<BuddhaMessage>({
    messages: load(SAVED.conversation, []),
    transport: new DefaultChatTransport({ api: `${API}/api/chat` }),
  });
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => save(SAVED.conversation, messages), [messages]);
  useEffect(() => save(SAVED.lang, lang), [lang]);
  useEffect(() => save(SAVED.thaiScript, thaiScript), [thaiScript]);

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    sendMessage({ text }, { body: { lang } });
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
            messages.map((m) => <Turn key={m.id} message={m} thaiScript={thaiScript} />)
          )}
          {status === "submitted" && <p className="text-sm text-muted-foreground">Searching the canon…</p>}
          {error && <p className="text-sm text-destructive">The reply didn’t arrive. Check that the agent is running and try again.</p>}
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
              }
            }}
            placeholder="Ask in English or Thai…"
            maxLength={2000}
            aria-label="Your message"
          />
          <InputGroupAddon align="block-end" className="flex-wrap justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={lang}
                onValueChange={(v) => v && setLang(v as ReplyLang)}
                aria-label="Reply language"
              >
                {REPLY_LANGS.map(([value, label]) => (
                  <ToggleGroupItem key={value} value={value}>
                    {label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <Toggle variant="outline" size="sm" pressed={thaiScript} onPressedChange={setThaiScript} aria-label="Show Pali in Thai script">
                อักษรไทย
              </Toggle>
            </div>
            <div className="flex items-center gap-1">
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
              <InputGroupButton type="submit" variant="default" size="icon-sm" disabled={busy || !input.trim()} aria-label="Send">
                <ArrowUpIcon />
              </InputGroupButton>
            </div>
          </InputGroupAddon>
        </InputGroup>
      </form>
      <p className="text-center text-xs text-muted-foreground">
        An AI reflecting on the Pali Canon, not the Buddha himself. Only the numbered cards quote the texts.
      </p>
    </div>
  );
}

function Turn({ message, thaiScript }: { message: BuddhaMessage; thaiScript: boolean }) {
  const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  if (message.role === "user") {
    return (
      <Message from="user">
        <MessageContent>{text}</MessageContent>
      </Message>
    );
  }
  const cards = message.parts.flatMap((p) => (p.type === "data-cards" ? p.data : []));
  const notice = message.parts.find((p) => p.type === "data-notice")?.data;
  const crisis = message.parts.find((p) => p.type === "data-crisis")?.data;
  const pali = message.parts.some((p) => p.type === "data-pali"); // Pali mode: the text is the canon's own words
  return (
    <Message from="assistant">
      <MessageContent className="w-full">
        {notice && (
          <Badge variant="outline" className="w-fit">
            {notice}
          </Badge>
        )}
        <div lang={pali ? "pi" : undefined}>
          <MessageResponse components={{ a: CiteLink }}>
            {linkCitations(pali && thaiScript ? quotesToThaiScript(text) : text, message.id)}
          </MessageResponse>
        </div>
        {crisis && <Hotlines crisis={crisis} />}
        <SourceCards replyId={message.id} cards={cards} thaiScript={thaiScript} />
      </MessageContent>
    </Message>
  );
}

// The numbers come from policy.yaml through the agent, never from the model (PRD §6).
function Hotlines({ crisis }: { crisis: Crisis }) {
  return (
    <Alert>
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

// [[cite:sn56.11#en5]] → a numbered link to its card, numbered in order of first use (the order
// the agent sends the cards in).
function linkCitations(text: string, replyId: string): string {
  const order: string[] = [];
  return text.replace(CITE, (_, id: string) => {
    if (!order.includes(id)) order.push(id);
    return ` [${order.indexOf(id) + 1}](#${cardAnchor(replyId, id)})`;
  });
}

// Streamdown types its link props two ways at once, so both fields are checked, not assumed.
function CiteLink(props: { href?: unknown; children?: unknown; node?: unknown }) {
  const href = typeof props.href === "string" ? props.href : undefined;
  const children = props.children as ReactNode;
  if (!href?.startsWith("#card-")) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  }
  return (
    <a href={href} className="no-underline" aria-label={`Source ${children}`}>
      <Badge variant="secondary" className="align-super text-[10px]">
        {children}
      </Badge>
    </a>
  );
}
