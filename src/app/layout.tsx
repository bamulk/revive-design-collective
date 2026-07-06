import type { Metadata } from "next";
import { Inter, Cormorant_Garamond } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
// Editorial display serif for the brand wordmark ("Revive | Design
// Collective") and all headings — a minimalist-luxury interior-design feel.
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  // 400 (wordmark "Design Collective" + light headings), 500 (default
  // headings), 600 (font-medium/semibold headings + wordmark "Revive").
  weight: ["400", "500", "600"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "Revive Design Collective",
  description: "Revive Design Collective — staging operations & client management",
  applicationName: "Revive Design Collective",
  // PWA manifest (see public/manifest.webmanifest)
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Revive",
    // "black-translucent" lets the system-chrome adapt to the
    // light/dark setting underneath the PWA, matching iOS's UI.
    statusBarStyle: "black-translucent",
  },
  icons: {
    // Browser tab + bookmarks. Padded version so the logo has breathing
    // room instead of being cropped to the edges.
    icon: "/icon.png",
    // iOS "Add to Home Screen" icon. Dark gold-on-black design that
    // fills edge-to-edge — iOS applies its own rounded corners, so a
    // bleed-to-edge image looks crisper than a padded one. Drop the
    // PNG at /public/apple-icon.png to update it later.
    apple: "/apple-icon.png",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // `cover` extends the page under iOS Safari's chrome / home
  // indicator so env(safe-area-inset-*) actually returns the right
  // values — the bottom nav uses safe-area padding and was sitting
  // wrong without it.
  viewportFit: "cover" as const,
  // Without this, the visual viewport shrinks when the keyboard
  // opens but the layout viewport (which fixed-bottom anchors to)
  // doesn't, so the bottom tab bar floats up halfway on screen.
  // "resizes-content" matches the visual viewport, keeping the nav
  // glued to the bottom edge.
  interactiveWidget: "resizes-content" as const,
  // Two-tone theme color so the iOS PWA chrome matches whichever
  // system mode the user is in.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#7c8b76" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1d1a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${cormorant.variable} h-full antialiased`}>
      <body className="min-h-full bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans">
        {children}
      </body>
    </html>
  );
}
