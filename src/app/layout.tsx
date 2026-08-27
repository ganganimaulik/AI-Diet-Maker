import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Diet Maker",
  description: "Strict meal prep calculator & formatter powered by Gemini",
  appleWebApp: {
    capable: true,
    title: "Diet Maker",
    statusBarStyle: "black-translucent",
  },
};

/**
 * `viewportFit: 'cover'` lets the layout paint under a notch; the stylesheet
 * pads content back out with env(safe-area-inset-*). Zoom is deliberately
 * left enabled — capping it would break pinch-zoom accessibility.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#03000a",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
