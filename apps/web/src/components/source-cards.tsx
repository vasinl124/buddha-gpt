import type { Card as SourceCard } from "@buddha-gpt/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { toThaiScript } from "@/lib/pali";
import { LANGS, displayRef, suttaCentralUrl } from "@/lib/refs";

// The passages a reply relies on, verbatim from the canon. Only these carry his words (PRD §5.2).
// They fold away under the reply, so the conversation reads as plain speech.
export function SourceCards({ cards, thaiScript }: { cards: SourceCard[]; thaiScript: boolean }) {
  if (cards.length === 0) return null;
  return (
    <details>
      <summary className="w-fit cursor-pointer text-xs text-muted-foreground select-none hover:text-foreground">
        Sources ({cards.length})
      </summary>
      <div className="flex flex-col gap-3 pt-3">
      {cards.map((card, i) => (
        <Card key={card.id} size="sm">
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
              const roman = card.texts[lang] ?? card.whole?.[lang];
              if (!roman) return null;
              const text = lang === "pi" && thaiScript ? toThaiScript(roman) : roman;
              return (
                <div key={lang} lang={lang} className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {label}
                    {lang === "pi" && thaiScript && " · Thai script"}
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
    </details>
  );
}
