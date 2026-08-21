import { createClient } from "@/lib/supabase/server";
import CollapsibleSection from "@/components/CollapsibleSection";
import MarketDomChart, { type ChartPoint } from "@/components/MarketDomChart";
import { fetchSacramentoDom } from "@/lib/market-dom";

/**
 * "Sacramento market" panel — median days-to-pending trend for the
 * metro (Zillow Research, cached 24h) with our own staged homes'
 * staged→pending days overlaid as a second series. Hides itself
 * entirely if the market fetch fails, so the dashboard never breaks
 * on Zillow's availability.
 */
export default async function MarketDomSection() {
  const market = await fetchSacramentoDom(24);
  if (!market) return null;

  // Our staged homes: days from staging to the daily Zillow check first
  // seeing the listing pending, median per month. Sparse and small-n —
  // rendered as dots/segments, honest about the gaps.
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("stages")
    .select("stage_date, listing_pending_notified_at")
    .not("stage_date", "is", null)
    .not("listing_pending_notified_at", "is", null);

  const byMonth = new Map<string, number[]>();
  for (const r of rows ?? []) {
    const staged = new Date(`${r.stage_date}T12:00:00Z`).getTime();
    const pending = new Date(String(r.listing_pending_notified_at)).getTime();
    const days = Math.round((pending - staged) / 86400000);
    if (!Number.isFinite(days) || days < 0 || days > 180) continue;
    const month = String(r.listing_pending_notified_at).slice(0, 7);
    const arr = byMonth.get(month) ?? [];
    arr.push(days);
    byMonth.set(month, arr);
  }
  const windowMonths = new Set(market.map((p) => p.month));
  const ours: ChartPoint[] = Array.from(byMonth.entries())
    .filter(([m]) => windowMonths.has(m))
    .map(([month, vals]) => {
      const sorted = [...vals].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median =
        sorted.length % 2 === 1
          ? sorted[mid]
          : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
      return { month, days: median };
    })
    .sort((a, b) => a.month.localeCompare(b.month));

  const latest = market[market.length - 1];
  const prev = market[market.length - 2];
  const delta = latest && prev ? latest.days - prev.days : 0;

  return (
    <CollapsibleSection
      id="market-dom"
      title="Sacramento market"
      defaultOpen={false}
      subtitle={
        latest
          ? `${latest.days} days to pending · ${
              delta === 0
                ? "flat"
                : delta > 0
                  ? `up ${delta} vs last month`
                  : `down ${Math.abs(delta)} vs last month`
            }`
          : undefined
      }
    >
      <MarketDomChart market={market} ours={ours} />
      <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
        Market line: Zillow Research median days from listing to pending,
        Sacramento metro, updated monthly. Gold dots: our staged homes —
        days from staging until the listing went pending (median per
        month).
      </p>
    </CollapsibleSection>
  );
}
