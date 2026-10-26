"use client";

import { ArrowRightIcon, XIcon } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const MAIL = "mailto:vasin.limsukhawat@gmail.com?subject=About%20Buddha%20GPT";
const ENTER = "animate-in fade-in-0 slide-in-from-bottom-1 duration-300 ease-out-quart";
// the question box's hard shadow, smaller
const LIFT = "border border-foreground bg-card shadow-[0_4px_0_var(--hero-shadow)]";

// Who made the app, and a way to write to him, in the lower right. Where the screen is wide enough
// to leave room beside the question box, the card sits in the corner; on smaller screens a pill sits
// over the box's right edge and opens the card, so neither covers the box or the Ask button.
export function BuiltBy() {
  const [wide, setWide] = useState(true);
  const [narrow, setNarrow] = useState(false);
  const [moved, setMoved] = useState(false); // after a click, focus follows the card or the pill
  const toggle = (set: (open: boolean) => void) => (open: boolean) => {
    set(open);
    setMoved(true);
  };
  return (
    <>
      <div className="fixed right-5 bottom-5 z-20 hidden min-[1440px]:block">
        {wide ? <Card onClose={() => toggle(setWide)(false)} focus={moved} /> : <Pill onOpen={() => toggle(setWide)(true)} focus={moved} />}
      </div>
      <div className="absolute right-0 bottom-full z-20 mb-3 min-[1440px]:hidden">
        {narrow ? <Card onClose={() => toggle(setNarrow)(false)} focus={moved} /> : <Pill onOpen={() => toggle(setNarrow)(true)} focus={moved} />}
      </div>
    </>
  );
}

function Card({ onClose, focus }: { onClose: () => void; focus: boolean }) {
  return (
    <div className={`w-60 rounded-xl p-3 ${LIFT} ${ENTER}`}>
      <div className="flex items-start gap-3">
        <Image src="/max.jpg" alt="" width={44} height={44} className="size-11 shrink-0 rounded-full border border-foreground" />
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-sm leading-tight font-semibold tracking-[-0.01em]">Built by Max</p>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">I made Buddha GPT. Hiring, or just curious?</p>
        </div>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Close" onClick={onClose} className="-mt-1 -mr-1 shrink-0">
          <XIcon />
        </Button>
      </div>
      <Button asChild size="sm" className="mt-3 w-full justify-between">
        <a href={MAIL} autoFocus={focus}>
          Contact me
          <ArrowRightIcon />
        </a>
      </Button>
    </div>
  );
}

function Pill({ onOpen, focus }: { onOpen: () => void; focus: boolean }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      autoFocus={focus}
      className={`flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-xs font-medium transition-transform hover:-translate-y-0.5 ${LIFT} ${ENTER}`}
    >
      <Image src="/max.jpg" alt="" width={28} height={28} className="size-7 rounded-full" />
      Built by Max
    </button>
  );
}
