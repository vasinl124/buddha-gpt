"use client";

import dynamic from "next/dynamic";
import { Frame } from "@/components/top-bar";

// The chat starts from the conversations saved in this browser, so it renders on the client only.
// Until it loads, the page shows its frame on its own.
export const ChatLoader = dynamic(() => import("@/components/chat").then((m) => m.Chat), {
  ssr: false,
  loading: () => <Frame />,
});
