"use client";

import dynamic from "next/dynamic";

// The chat starts from the conversation saved in this browser, so it renders on the client only.
export const ChatLoader = dynamic(() => import("@/components/chat").then((m) => m.Chat), {
  ssr: false,
  loading: () => <div className="flex-1" />,
});
