import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-2 font-medium rounded-lg select-none whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-brand disabled:opacity-50 disabled:pointer-events-none";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand text-white hover:bg-brand-hover shadow-sm shadow-black/10",
  secondary:
    "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900 shadow-sm",
  ghost:
    "text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800",
  danger:
    "bg-white dark:bg-slate-900 text-red-600 border border-red-200 hover:bg-red-50",
};

const sizes: Record<Size, string> = {
  sm: "text-xs px-2.5 py-1.5",
  md: "text-sm px-3.5 py-2",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentPropsWithoutRef<"button"> & { variant?: Variant; size?: Size }) {
  return (
    <button
      {...props}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
    />
  );
}

export function LinkButton({
  variant = "primary",
  size = "md",
  className = "",
  href,
  children,
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {children}
    </Link>
  );
}

export function Card({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700/70 shadow-sm shadow-slate-900/[0.02] ${className}`}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start sm:items-center justify-between gap-4 flex-col sm:flex-row">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-slate-700 dark:text-slate-300 mt-0.5">{subtitle}</p>}
      </div>
      {actions && (
        // Mobile: 2-column grid so 3-4 long-labeled buttons stack
        // cleanly instead of squishing onto one row. Desktop: a single
        // row, intrinsic widths.
        <div className="grid grid-cols-2 sm:flex sm:flex-row gap-2 w-full sm:w-auto">
          {actions}
        </div>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  // Color language across the app:
  //   scheduled (upcoming stage) → blue
  //   staged (next event is destage) → orange
  //   destaged → emerald
  //   completed → slate (neutral)
  //   cancelled → rose
  const styles: Record<string, string> = {
    scheduled: "bg-blue-50 text-blue-700 ring-blue-200",
    staged: "bg-orange-50 text-orange-800 ring-orange-200",
    destaged: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    completed: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 ring-slate-200",
    cancelled: "bg-rose-50 text-rose-700 ring-rose-200",
  };
  // Display labels — DB value 'destaged' is shown as 'Destages' to
  // match the section name used throughout the app.
  const LABEL: Record<string, string> = {
    scheduled: "Scheduled",
    staged: "Staged",
    destaged: "Destages",
    completed: "Completed",
    cancelled: "Cancelled",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${
        styles[status] ?? "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 ring-slate-200"
      }`}
    >
      {LABEL[status] ?? status}
    </span>
  );
}
