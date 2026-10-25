"use client";

import { useChat } from "@ai-sdk/react";
import { CITE, type ChatData } from "@buddha-gpt/shared";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowUpIcon, SquarePenIcon } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { cardAnchor } from "@/lib/refs";

type BuddhaMessage = UIMessage<never, ChatData>;

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:7891";
const SAVED = "buddha-gpt:conversation"; // the conversation lives in this browser only (PRD §11)
const STARTERS = ["What is suffering?", "How do I stop being angry?", "My father died last month", "ทุกข์คืออะไร"];

function saved(): BuddhaMessage[] {
  try {
    return JSON.parse(localStorage.getItem(SAVED) ?? "[]");
  } catch {
    return [];
  }
}

export function Chat() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, setMessages, status, error } = useChat<BuddhaMessage>({
    messages: saved(),
    transport: new DefaultChatTransport({ api: `${API}/api/chat` }),
  });
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    try {
      localStorage.setItem(SAVED, JSON.stringify(messages));
    } catch {
      // private mode or full storage: the conversation just isn't kept
    }
  }, [messages]);

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
            messages.map((m) => <Turn key={m.id} message={m} />)
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
          <InputGroupAddon align="block-end" className="justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy || messages.length === 0}
              onClick={() => setMessages([])}
            >
              <SquarePenIcon data-icon="inline-start" />
              New conversation
            </Button>
            <InputGroupButton type="submit" variant="default" size="icon-sm" disabled={busy || !input.trim()} aria-label="Send">
              <ArrowUpIcon />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
      <p className="text-center text-xs text-muted-foreground">
        An AI reflecting on the Pali Canon, not the Buddha himself. Only the numbered cards quote the texts.
      </p>
    </div>
  );
}

function Turn({ message }: { message: BuddhaMessage }) {
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
  return (
    <Message from="assistant">
      <MessageContent className="w-full">
        {notice && (
          <Badge variant="outline" className="w-fit">
            {notice}
          </Badge>
        )}
        <MessageResponse components={{ a: CiteLink }}>{linkCitations(text)}</MessageResponse>
        <SourceCards cards={cards} />
      </MessageContent>
    </Message>
  );
}

// [[cite:sn56.11#en5]] → a numbered link to its card, numbered in order of first use (the order
// the agent sends the cards in).
function linkCitations(text: string): string {
  const order: string[] = [];
  return text.replace(CITE, (_, id: string) => {
    if (!order.includes(id)) order.push(id);
    return ` [${order.indexOf(id) + 1}](#${cardAnchor(id)})`;
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
