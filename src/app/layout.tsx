import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

export const metadata: Metadata = {
  title: "Chain Trader | Supply & Demand Strategy",
  description: "Semi-automated crypto trading app implementing the Chain Strategy for Hyperliquid",
  keywords: ["trading", "crypto", "supply and demand", "hyperliquid", "chain strategy"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable} dark`}>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
