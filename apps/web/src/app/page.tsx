import { ChatLoader } from "@/components/chat-loader";
import { HealthStatus } from "@/components/health-status";

export default function Home() {
  return (
    <main className="mx-auto flex h-svh w-full max-w-2xl flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-lg font-medium">Buddha GPT</h1>
        <p className="text-sm text-muted-foreground">A conversation with the Buddha where every quote is real.</p>
      </header>
      <ChatLoader />
      <footer className="flex justify-center">
        <HealthStatus />
      </footer>
    </main>
  );
}
