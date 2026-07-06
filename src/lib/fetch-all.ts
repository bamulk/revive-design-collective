import "server-only";

/**
 * Fetch EVERY row of a Supabase query by paging through PostgREST's
 * max-rows cap (project default 1000). An un-paginated .select() — and
 * even an explicit .limit() above the cap — silently truncates at 1000
 * rows, which corrupted the finance totals once expenses crossed 1000
 * rows. Any query whose row count can grow past ~1000 must go through
 * this helper.
 *
 * The builder receives the (from, to) range for each page and must
 * return a NEW query each call, e.g.:
 *
 *   const rows = await fetchAllRows((from, to) =>
 *     supabase
 *       .from("expenses")
 *       .select("date, amount")
 *       .order("date", { ascending: true })
 *       .order("id")            // tiebreaker — see below
 *       .range(from, to),
 *   );
 *
 * IMPORTANT: the query's ORDER BY must be deterministic (add a unique
 * tiebreaker like `id` after any non-unique sort key). Otherwise rows
 * that tie on the sort key can shuffle between pages and get skipped
 * or duplicated at page boundaries.
 */
export async function fetchAllRows<T>(
  build: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
