import type { Metadata } from "next";
import { Geist_Mono, Noto_Sans, Noto_Sans_Thai, Noto_Serif, Noto_Serif_Thai } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// Noto Sans covers Pali diacritics (ā ṃ ñ ṭ ḍ ṇ ḷ); Noto Sans Thai covers Thai.
// globals.css combines them into --font-sans, and the serifs, which set his replies, into --font-serif.
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
      className={`${notoSans.variable} ${notoThai.variable} ${notoSerif.variable} ${notoSerifThai.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
