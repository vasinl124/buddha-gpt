import type { Card as SourceCard } from "@buddha-gpt/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { LANGS, cardAnchor, displayRef, suttaCentralUrl } from "@/lib/refs";

// The passages a reply relies on, verbatim from the canon. Only these carry his words (PRD §5.2).
export function SourceCards({ replyId, cards }: { replyId: string; cards: SourceCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {cards.map((card, i) => (
        <Card key={card.id} id={cardAnchor(replyId, card.id)} size="sm" className="scroll-mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Badge variant="secondary">{i + 1}</Badge>
              {displayRef(card.sutta_id)}
              {card.title_pi && <span className="font-normal text-muted-foreground">{card.title_pi}</span>}
            </CardTitle>
            {card.title_en && <CardDescription>{card.title_en}</CardDescription>}
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {LANGS.map(({ lang, label }) => {
              const text = card.texts[lang] ?? card.whole?.[lang];
              if (!text) return null;
              return (
                <div key={lang} lang={lang} className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {label}
                    {!card.texts[lang] && " · whole sutta"}
                  </span>
                  <p className="text-sm whitespace-pre-line">{text}</p>
                </div>
              );
            })}
          </CardContent>
          <CardFooter className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <a className="underline underline-offset-2" href={suttaCentralUrl(card.sutta_id)} target="_blank" rel="noreferrer">
              Read the whole sutta on SuttaCentral
            </a>
            <span>
              {LANGS.filter(({ lang }) => card.texts[lang] ?? card.whole?.[lang])
                .map(({ label, credit }) => `${label}: ${credit}`)
                .join(" · ")}
            </span>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
