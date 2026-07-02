import type { Metadata } from "next";
import { Inter, Montserrat } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
// Display face for the brand wordmark (the "Revive | Design Collective" logo).
const montserrat = Montserrat({
  subsets: ["latin"],
  // Only the weights actually rendered: 200 (logo "Design Collective"),
  // 400 (logo "Revive" + unweighted headings), 500/600 (font-medium /
  // font-semibold headings). No font-light (300) or font-bold (700) in
  // use, so they're not loaded.
  weight: ["200", "400", "500", "600"],
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
    { media: "(prefers-color-scheme: light)", color: "#a9761e" },
    { media: "(prefers-color-scheme: dark)", color: "#161512" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${montserrat.variable} h-full antialiased`}>
      <body className="min-h-full bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans">
        {children}
      </body>
    </html>
  );
}
