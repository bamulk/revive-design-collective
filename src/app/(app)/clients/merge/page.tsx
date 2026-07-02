import { createClient } from "@/lib/supabase/server";
import MergeGroupForm from "@/components/MergeGroupForm";
import ManualMergeForm from "@/components/ManualMergeForm";
import BackLink from "@/components/BackLink";
import { Card, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/require-admin";

/**
 * Normalize a client name for fuzzy duplicate detection. Lowercase, strip
 * punctuation and "for X" annotations, collapse whitespace.
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+for\s+.+$/i, "") // "Melissa Roybal for Julie" → "melissa roybal"
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default async function MergeClientsPage() {
  await requireAdmin();
  const supabase = await createClient();

  // Pull all clients and stage counts (one extra round-trip; runs fast at
  // 250-ish clients and 800 stages).
  const [{ data: clients }, { data: stageCounts }] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, email, phone")
      .order("name"),
    supabase.from("stages").select("client_id"),
  ]);

  const countByClient = new Map<string, number>();
  for (const s of stageCounts ?? []) {
    countByClient.set(s.client_id, (countByClient.get(s.client_id) ?? 0) + 1);
  }

  // Group by normalized name; show groups with >1 client.
  const groups = new Map<string, typeof clients>();
  for (const c of clients ?? []) {
    const key = normalizeName(c.name);
    if (!key) continue;
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }

  const dupGroups = [...groups.entries()]
    .filter(([, arr]) => arr && arr.length > 1)
    .map(([key, arr]) => {
      const enriched = (arr ?? [])
        .map((c) => ({
          ...c,
          stageCount: countByClient.get(c.id) ?? 0,
        }))
        .sort((a, b) => b.stageCount - a.stageCount); // most stages first
      return { key, clients: enriched };
    })
    .sort((a, b) => {
      // groups with the most total stages first — those merges have the
      // most cleanup payoff
      const ta = a.clients.reduce((s, c) => s + c.stageCount, 0);
      const tb = b.clients.reduce((s, c) => s + c.stageCount, 0);
      return tb - ta;
    });

  const manualOptions = (clients ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    stageCount: countByClient.get(c.id) ?? 0,
  }));

  const dupClientTotal = dupGroups.reduce((s, g) => s + g.clients.length, 0);
  const couldSave = dupClientTotal - dupGroups.length;

  return (
    <div className="space-y-8 max-w-3xl">
      <PageHeader
        title="Merge clients"
        subtitle="Combine duplicate clients into one record"
        actions={
          <BackLink
            fallback="/clients"
            className="text-sm text-slate-700 dark:text-slate-300 hover:underline"
          >
            ← Back
          </BackLink>
        }
      />

      {dupGroups.length === 0 ? (
        <Card className="p-5 text-sm text-slate-600 dark:text-slate-400">
          No likely-duplicate groups detected. You can still merge any two
          clients manually below.
        </Card>
      ) : (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">
              Suggested duplicates
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {dupGroups.length} group{dupGroups.length === 1 ? "" : "s"} ·{" "}
              merging would reduce client count by {couldSave}
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Each group is a set of clients whose names normalize to the same
            string (case, punctuation, and trailing &quot;for X&quot; ignored).
            Pick the one to keep — the others get folded in, their stages
            re-pointed, and they get deleted. Contact fields are
            backfilled from losers when blank.
          </p>
          <div className="space-y-3">
            {dupGroups.map((g) => (
              <MergeGroupForm
                key={g.key}
                clients={g.clients}
                defaultKeepId={g.clients[0].id}
              />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Manual merge</h2>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          For duplicates the auto-detector misses (alias swaps, completely
          different spellings, etc.).
        </p>
        <ManualMergeForm options={manualOptions} />
      </section>
    </div>
  );
}
