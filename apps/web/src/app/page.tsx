import { ChatLoader } from "@/components/chat-loader";

export default function Home() {
  return (
    <main className="mx-auto flex h-svh w-full max-w-2xl flex-col px-4 pb-3">
      <ChatLoader />
    </main>
  );
}
