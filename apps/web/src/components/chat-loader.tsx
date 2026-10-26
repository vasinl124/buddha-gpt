"use client";

import dynamic from "next/dynamic";
import { TopBar } from "@/components/top-bar";

// The chat starts from the conversation saved in this browser, so it renders on the client only.
// Until it loads, the bar shows on its own.
export const ChatLoader = dynamic(() => import("@/components/chat").then((m) => m.Chat), {
  ssr: false,
  loading: () => (
    <>
      <TopBar />
      <div className="flex-1" />
    </>
  ),
});
