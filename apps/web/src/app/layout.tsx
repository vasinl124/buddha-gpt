import type { Metadata } from "next";
import { DM_Serif_Display, Geist_Mono, Inter_Tight, Noto_Sans, Noto_Sans_Thai, Noto_Serif, Noto_Serif_Thai } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// Inter Tight sets the app's own words and DM Serif Display its headlines. Noto Sans covers any Pali
// diacritic (ā ṃ ñ ṭ ḍ ṇ ḷ) they lack, and Noto Sans Thai covers Thai. globals.css combines them into
// --font-sans and --font-display, and the serifs, which set his replies, into --font-serif.
const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin", "latin-ext"],
});

const dmSerif = DM_Serif_Display({
  variable: "--font-dm-serif",
  weight: "400",
  subsets: ["latin", "latin-ext"],
});

const notoSans = Noto_Sans({
  variable: "--font-noto-sans",
  subsets: ["latin", "latin-ext"],
});

const notoThai = Noto_Sans_Thai({
  variable: "--font-noto-thai",
  subsets: ["thai"],
});

const notoSerif = Noto_Serif({
  variable: "--font-noto-serif",
  subsets: ["latin", "latin-ext"],
});

const notoSerifThai = Noto_Serif_Thai({
  variable: "--font-noto-serif-thai",
  subsets: ["thai"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const description = "Talk with the Buddha in English, Thai or Pali. Every quote is real, from the Pali Canon.";

// The icons and the link preview are files beside this one (icon.svg, apple-icon.png,
// opengraph-image.png), drawn by docs/brand/render.mjs. A shared link needs their absolute address,
// so a hosted build sets SITE_URL to its public origin.
export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || "http://localhost:5005"),
  title: "Buddha GPT",
  description,
  openGraph: { title: "Buddha GPT", description, siteName: "Buddha GPT", type: "website" },
  twitter: { card: "summary_large_image", title: "Buddha GPT", description },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${interTight.variable} ${dmSerif.variable} ${notoSans.variable} ${notoThai.variable} ${notoSerif.variable} ${notoSerifThai.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
