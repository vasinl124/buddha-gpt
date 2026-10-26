import { ArrowRightIcon } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";

// the contact section of his site, which has his email; a new tab, so the conversation stays
const CONTACT = "https://maxlim.xyz/#contact";

// Who made the app, and a way to reach him: at the foot of the welcome panel, in its lower right
// on a wider screen. Only the empty page shows it, so it never sits over a conversation.
export function BuiltBy({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border border-foreground bg-card p-3 shadow-[0_4px_0_var(--hero-shadow)] md:w-[30rem] md:self-end ${className}`}
    >
      <Image src="/max.jpg" alt="" width={44} height={44} className="size-11 shrink-0 rounded-full border border-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-tight font-semibold tracking-[-0.01em]">Built by Max</p>
        <p className="mt-1 text-xs leading-snug text-muted-foreground">I made Buddha GPT. Hiring, or just curious?</p>
      </div>
      <Button asChild size="sm" className="shrink-0">
        <a href={CONTACT} target="_blank" rel="noreferrer">
          Contact me
          <ArrowRightIcon />
        </a>
      </Button>
    </div>
  );
}
