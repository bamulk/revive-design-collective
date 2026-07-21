import {
  Home as HomeIcon,
  PlusCircle,
  LayoutGrid,
  CalendarDays,
  Map as MapIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/fetch-all";
import { PageHeader, LinkButton } from "@/components/ui";
import StagesListView, { type StageRow } from "./StagesListView";
import ScrollMemory from "@/components/ScrollMemory";

/**
 * Flat searchable + filterable list of every stage. Cousin page to
 * /stages/groups (status-grouped accordion view) — this one is the
 * "give me a table I can slice" view.
 */
export default async function StagesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };
  const isAdmin = me?.role === "admin";

  // Every non-estimate stage ever — pages past the 1000-row cap. The
  // id tiebreaker keeps pagination stable when created_at ties.
  const rows = await fetchAllRows((from, to) =>
    supabase
      .from("stages")
      .select(
        "id, address, city, status, stage_date, destage_date, amount, paid_at, team, destage_team, escrow, clients(name)",
      )
      .neq("status", "estimate")
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to),
  );

  const stages: StageRow[] = (rows ?? []).map((s: any) => ({
    id: s.id,
    address: s.address,
    city: s.city ?? null,
    client_name: s.clients?.name ?? null,
    status: s.status,
    stage_date: s.stage_date,
    destage_date: s.destage_date,
    amount: Number(s.amount ?? 0),
    paid_at: s.paid_at ?? null,
    team: (s.team as "grey" | "white" | "little" | null) ?? null,
    destage_team:
      (s.destage_team as "grey" | "white" | "little" | null) ?? null,
    escrow: !!s.escrow,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stages"
        subtitle={`${stages.length} job${stages.length === 1 ? "" : "s"}`}
        actions={
          <>
            <LinkButton href="/stages/groups" variant="secondary">
              <LayoutGrid size={14} /> Groups
            </LinkButton>
            <LinkButton href="/stages/calendar" variant="secondary">
              <CalendarDays size={14} /> Calendar
            </LinkButton>
            <LinkButton href="/stages/map" variant="secondary">
              <MapIcon size={14} /> Map
            </LinkButton>
            {isAdmin && (
              <LinkButton href="/stages/new">
                <PlusCircle size={14} /> New stage
              </LinkButton>
            )}
          </>
        }
      />

      <ScrollMemory id="stages-list" />
      <StagesListView stages={stages} isAdmin={isAdmin} />
    </div>
  );
}
