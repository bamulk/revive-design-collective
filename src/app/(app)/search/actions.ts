"use server";

import { createClient } from "@/lib/supabase/server";

export type SearchHit = {
  type: "stage" | "estimate" | "client";
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
};

/**
 * Universal search across stages, estimates, and clients. Matches stage
 * address/city and client name/email/phone. All internal team members
 * (admins, stagers, lead stagers) can search clients — they all have
 * client access — and RLS (clients_internal_all) gates the read.
 */
export async function universalSearchAction(
  query: string,
): Promise<SearchHit[]> {
  // Strip characters that would break PostgREST's or() filter syntax or
  // act as ilike wildcards, so user input can't broaden/break the query.
  const safe = query.replace(/[,()*%_]/g, " ").trim();
  if (safe.length < 2) return [];

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  // Only internal team members reach the (app) shell, but double-check.
  if (!me?.role) return [];

  // NOTE: inside PostgREST .or() filter strings the ilike wildcard is
  // `*` (not `%`). Using `%` here matches a literal percent → no hits.
  const like = `*${safe}*`;
  const hits: SearchHit[] = [];
  const clientName = (c: unknown) =>
    (Array.isArray(c) ? c[0]?.name : (c as { name?: string } | null)?.name) ??
    null;

  // Active stages (by address/city).
  const { data: stageRows } = await supabase
    .from("stages")
    .select("id, address, city, clients(name)")
    .neq("status", "estimate")
    .neq("status", "cancelled")
    .or(`address.ilike.${like},city.ilike.${like}`)
    .order("stage_date", { ascending: false })
    .limit(8);
  for (const s of stageRows ?? []) {
    hits.push({
      type: "stage",
      id: s.id,
      title: s.address,
      subtitle:
        [s.city, clientName(s.clients)].filter(Boolean).join(" · ") || null,
      href: `/stages/${s.id}`,
    });
  }

  // Estimates (status = 'estimate').
  const { data: estRows } = await supabase
    .from("stages")
    .select("id, address, city, clients(name)")
    .eq("status", "estimate")
    .or(`address.ilike.${like},city.ilike.${like}`)
    .limit(5);
  for (const e of estRows ?? []) {
    hits.push({
      type: "estimate",
      id: e.id,
      title: e.address,
      subtitle:
        [e.city, clientName(e.clients)].filter(Boolean).join(" · ") || null,
      href: `/estimates/${e.id}`,
    });
  }

  // Clients (any team member — they all have client access now).
  const { data: clientRows } = await supabase
    .from("clients")
    .select("id, name, email, phone")
    .or(`name.ilike.${like},email.ilike.${like},phone.ilike.${like}`)
    .limit(6);
  for (const c of clientRows ?? []) {
    hits.push({
      type: "client",
      id: c.id,
      title: c.name,
      subtitle: c.email || c.phone || null,
      href: `/clients/${c.id}`,
    });
  }

  return hits;
}
