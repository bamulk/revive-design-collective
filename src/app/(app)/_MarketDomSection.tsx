import CollapsibleSection from "@/components/CollapsibleSection";
import MarketDomChart from "@/components/MarketDomChart";
import { fetchSacramentoDaysToClosed } from "@/lib/market-dom";

/**
 * "Sacramento market" panel — days from listing to closed for the metro
 * (Zillow Research: median days to pending + mean days to close, cached
 * 24h). Hides itself entirely if either feed fails, so the dashboard
 * never breaks on Zillow's availability.
 *
 * No "our staged homes" overlay here: we don't record close dates, and
 * mixing a staged→pending series onto a listing→closed axis would be
 * comparing different things.
 */
export default async function MarketDomSection() {
  const market = await fetchSacramentoDaysToClosed(24);
  if (!market) return null;

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
          ? `${latest.days} days till closed · ${
              delta === 0
                ? "flat"
                : delta > 0
                  ? `up ${delta} vs prior month`
                  : `down ${Math.abs(delta)} vs prior month`
            }`
          : undefined
      }
    >
      <MarketDomChart market={market} />
      <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
        Days from listing to closed sale, Sacramento metro — Zillow
        Research&rsquo;s median days to pending plus mean days to close,
        updated monthly (the close figure runs about a month behind).
      </p>
    </CollapsibleSection>
  );
}
