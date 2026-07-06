"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Home,
  CalendarDays,
  CalendarCheck,
  UserCog,
  FileText,
  FileSignature,
  DollarSign,
  Activity,
  Truck,
  Clock,
  Menu,
  X,
} from "lucide-react";
import SignOutButton from "./SignOutButton";
import NavPushToggle from "./NavPushToggle";
import UniversalSearch from "./UniversalSearch";

type Item = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  match: (p: string) => boolean;
};

// Order matters — the first PRIMARY_COUNT items stay inline; the rest
// get tucked into the "More" hamburger menu in both layouts.
const PRIMARY_COUNT = 4;

function buildItems(isAdmin: boolean, canEstimate: boolean): Item[] {
  // Non-admin employees only get the three at-a-glance pages by
  // default — no client list, no finance/invoicing, no team admin.
  // Lead Stagers get the Estimates link on top of the stager set.
  if (!isAdmin) {
    const items: Item[] = [
      { href: "/", label: "Home", icon: LayoutDashboard, match: (p) => p === "/" },
      {
        href: "/stages/groups",
        label: "Stages",
        icon: Home,
        match: (p) =>
          p === "/stages/groups" ||
          p === "/stages/board" ||
          p === "/stages" ||
          /^\/stages\/(?!board|groups|calendar|new).+/.test(p),
      },
      {
        href: "/stages/calendar",
        label: "Calendar",
        icon: CalendarDays,
        match: (p) => p.startsWith("/stages/calendar"),
      },
      {
        href: "/clients",
        label: "Clients",
        icon: Users,
        match: (p) => p.startsWith("/clients"),
      },
      {
        href: "/availability",
        label: "Availability",
        icon: CalendarCheck,
        match: (p) => p.startsWith("/availability"),
      },
      {
        href: "/maintenance",
        label: "Maintenance",
        icon: Truck,
        match: (p) => p.startsWith("/maintenance"),
      },
      {
        href: "/timeclock",
        label: "Time clock",
        icon: Clock,
        match: (p) => p.startsWith("/timeclock"),
      },
    ];
    if (canEstimate) {
      items.push({
        href: "/estimates",
        label: "Estimates",
        icon: FileSignature,
        match: (p) => p.startsWith("/estimates"),
      });
    }
    return items;
  }
  return [
    { href: "/", label: "Home", icon: LayoutDashboard, match: (p) => p === "/" },
    {
      href: "/clients",
      label: "Clients",
      icon: Users,
      match: (p) => p.startsWith("/clients"),
    },
    {
      href: "/stages/groups",
      label: "Stages",
      icon: Home,
      match: (p) =>
        p === "/stages/groups" ||
        p === "/stages/board" ||
        p === "/stages" ||
        /^\/stages\/(?!board|groups|calendar|new).+/.test(p),
    },
    {
      href: "/stages/calendar",
      label: "Calendar",
      icon: CalendarDays,
      match: (p) => p.startsWith("/stages/calendar"),
    },
    // Below this line → tucked into the More menu.
    {
      href: "/estimates",
      label: "Estimates",
      icon: FileSignature,
      match: (p) => p.startsWith("/estimates"),
    },
    {
      href: "/finance",
      label: "Finance",
      icon: DollarSign,
      match: (p) => p.startsWith("/finance"),
    },
    {
      href: "/employees",
      label: "Team",
      icon: UserCog,
      match: (p: string) => p.startsWith("/employees"),
    },
    {
      href: "/activity",
      label: "Activity",
      icon: Activity,
      match: (p: string) => p.startsWith("/activity"),
    },
    {
      href: "/maintenance",
      label: "Maintenance",
      icon: Truck,
      match: (p: string) => p.startsWith("/maintenance"),
    },
    {
      href: "/timeclock",
      label: "Time clock",
      icon: Clock,
      match: (p: string) => p.startsWith("/timeclock"),
    },
    {
      href: "/availability",
      label: "Availability",
      icon: CalendarCheck,
      match: (p: string) => p.startsWith("/availability"),
    },
    {
      href: "/admin/contract",
      label: "Contract",
      icon: FileText,
      match: (p: string) => p.startsWith("/admin/contract"),
    },
  ];
}

export default function NavBar({
  isAdmin,
  canEstimate = false,
  displayName,
  vapidPublicKey,
}: {
  isAdmin: boolean;
  /** True for lead-stager (and admin) — adds the Estimates nav link. */
  canEstimate?: boolean;
  displayName: string;
  /** Public VAPID key — passed in so the nav can host the push toggle. */
  vapidPublicKey?: string;
}) {
  const pathname = usePathname();
  const items = buildItems(isAdmin, canEstimate);
  const primary = items.slice(0, PRIMARY_COUNT);
  const overflow = items.slice(PRIMARY_COUNT);
  const overflowActive = overflow.some((n) => n.match(pathname));

  return (
    <>
      <header
        className="sticky top-0 z-[1100] backdrop-blur-md bg-white dark:bg-slate-900/85 border-b border-slate-200 dark:border-slate-700/70"
        style={{
          // After viewportFit: 'cover', the page extends under the
          // iOS status bar / notch. Push the visible content down by
          // the safe-area inset so the logo + Sign out aren't hidden
          // behind the battery indicator.
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-4">
          <Link
            href="/"
            prefetch={false}
            className="inline-flex items-center font-display"
            aria-label="Revive Design Collective — Home"
          >
            {/* Text wordmark: "Revive | Design Collective" in Cormorant
                Garamond. "Revive" reads in ink (cream in dark mode) and the
                "Design Collective" half is sage, split by a thin vertical
                rule. Slight uppercase tracking gives it an editorial feel. */}
            <span className="text-xl sm:text-2xl font-medium tracking-wide text-charcoal dark:text-cream">
              Revive
            </span>
            <span
              className="mx-2.5 h-5 w-px bg-slate-300 dark:bg-slate-600"
              aria-hidden="true"
            />
            <span className="text-xl sm:text-2xl font-normal tracking-wide text-brand">
              Design Collective
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1 text-sm ml-4">
            {primary.map((n) => {
              const Icon = n.icon;
              const active = n.match(pathname);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  prefetch={false}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md ${
                    active
                      ? "bg-slate-900 text-white"
                      : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:text-slate-100"
                  }`}
                >
                  <Icon size={14} />
                  {n.label}
                </Link>
              );
            })}
            {overflow.length > 0 && (
              <MoreMenu
                items={overflow}
                pathname={pathname}
                active={overflowActive}
              />
            )}
          </nav>

          <div className="ml-auto flex items-center gap-2 sm:gap-3 text-sm">
            <UniversalSearch />
            {vapidPublicKey && <NavPushToggle publicKey={vapidPublicKey} />}
            <span className="text-slate-700 dark:text-slate-300 hidden sm:block truncate max-w-[160px]">
              {displayName}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      {/* Mobile bottom tab bar.
          NOTE: do NOT add transform / will-change here. On iOS Safari
          a transform on a position:fixed element detaches it from the
          viewport — it then scrolls with the page and lands mid-
          content instead of sticking to the bottom. */}
      {/* Standard bottom tab bar: solid, edge-to-edge, pinned flush to
          the bottom with rounded top corners. paddingBottom = just the
          home-indicator safe area. */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-[1100] bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 rounded-t-2xl shadow-[0_-4px_16px_rgba(0,0,0,0.06)] dark:shadow-[0_-4px_16px_rgba(0,0,0,0.4)] [-webkit-tap-highlight-color:transparent]"
        style={{
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <ul
          className="grid max-w-lg mx-auto"
          style={{
            gridTemplateColumns: `repeat(${primary.length + (overflow.length > 0 ? 1 : 0)}, minmax(0, 1fr))`,
          }}
        >
          {primary.map((n) => {
            const Icon = n.icon;
            const active = n.match(pathname);
            return (
              <li key={n.href}>
                <Link
                  href={n.href}
                  prefetch={false}
                  className={`flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium ${
                    active
                      ? "text-brand"
                      : "text-slate-600 dark:text-slate-400 active:text-slate-900 dark:text-slate-100"
                  }`}
                >
                  <span
                    className={`inline-flex items-center justify-center w-9 h-6 rounded-full ${
                      active ? "bg-brand/15" : ""
                    }`}
                  >
                    <Icon size={18} />
                  </span>
                  {n.label}
                </Link>
              </li>
            );
          })}
          {overflow.length > 0 && (
            <MobileMoreSlot
              items={overflow}
              pathname={pathname}
              active={overflowActive}
            />
          )}
        </ul>
      </nav>
    </>
  );
}

/**
 * Desktop "More" dropdown — anchored to the trigger, click-outside
 * closes it. Plain useEffect / useRef instead of a portal since the
 * top bar is sticky and tall enough to host the dropdown.
 */
function MoreMenu({
  items,
  pathname,
  active,
}: {
  items: Item[];
  pathname: string;
  active: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm ${
          active
            ? "bg-slate-900 text-white"
            : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:text-slate-100"
        }`}
      >
        <Menu size={14} />
        More
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 min-w-[180px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md py-1 z-[1200]"
        >
          {items.map((n) => {
            const Icon = n.icon;
            const isActive = n.match(pathname);
            return (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                role="menuitem"
                className={`flex items-center gap-2 px-3 py-2 text-sm ${
                  isActive
                    ? "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium"
                    : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900"
                }`}
              >
                <Icon size={14} />
                {n.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Mobile "More" slot — fills the 5th column of the bottom tab bar and
 * opens a full-width bottom sheet listing the overflow items.
 */
function MobileMoreSlot({
  items,
  pathname,
  active,
}: {
  items: Item[];
  pathname: string;
  active: boolean;
}) {
  const [open, setOpen] = useState(false);

  // Close on route change.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium w-full ${
          active ? "text-brand" : "text-slate-600 dark:text-slate-400 active:text-slate-900 dark:text-slate-100"
        }`}
      >
        <span
          className={`inline-flex items-center justify-center w-9 h-6 rounded-full ${
            active ? "bg-brand/15" : ""
          }`}
        >
          <Menu size={18} />
        </span>
        More
      </button>

      {open && (
        <div className="fixed inset-0 z-[1200]">
          {/* Scrim */}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="absolute inset-0 bg-slate-900/40"
          />
          {/* Sheet */}
          <div
            className="absolute inset-x-0 bottom-0 bg-white dark:bg-slate-900 rounded-t-2xl shadow-2xl"
            style={{
              paddingBottom:
                "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)",
            }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
              <h3 className="font-semibold text-slate-900 dark:text-slate-100">More</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="w-8 h-8 inline-flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X size={16} />
              </button>
            </div>
            <ul className="py-2">
              {items.map((n) => {
                const Icon = n.icon;
                const isActive = n.match(pathname);
                return (
                  <li key={n.href}>
                    <Link
                      href={n.href}
                      onClick={() => setOpen(false)}
                      className={`flex items-center gap-3 px-5 py-3 text-base ${
                        isActive
                          ? "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium"
                          : "text-slate-800 dark:text-slate-200 active:bg-slate-50 dark:bg-slate-900"
                      }`}
                    >
                      <Icon size={18} />
                      {n.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </li>
  );
}
