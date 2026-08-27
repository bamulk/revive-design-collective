import { PlusCircle, Home as HomeIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/fetch-all";
import { PageHeader, LinkButton } from "@/components/ui";
import CalendarEventsAdmin from "./CalendarEventsAdmin";
import CalendarView, {
  type CalendarStage,
  type CalendarEvent,
} from "./CalendarView";

export const dynamic = "force-dynamic";

/**
 * Calendar page: shows every stage_date and destage_date as colored
 * pills on a month grid or week list. Cancelled stages are excluded.
 */
export default async function CalendarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };
  const isAdmin = (me as { role?: string } | null)?.role === "admin";
  // Every non-cancelled/estimate stage ever (~800 and growing) — page
  // past the 1000-row cap.
  const stages = await fetchAllRows((from, to) =>
    supabase
      .from("stages")
      .select("id, address, status, stage_date, destage_date, clients(name)")
      .not("status", "in", "(cancelled,estimate)")
      .order("id")
      .range(from, to),
  );

  // Manual (non-stage) entries — holidays, warehouse days, vacations.
  const { data: customRows } = await supabase
    .from("calendar_events")
    .select("id, title, event_date, end_date, note")
    .order("event_date");
  const customEvents: CalendarEvent[] = (customRows ?? []).map((e: any) => ({
    id: e.id,
    title: e.title,
    event_date: e.event_date,
    end_date: e.end_date ?? null,
    note: e.note ?? null,
  }));

  const events: CalendarStage[] = (stages ?? []).map((s: any) => ({
    id: s.id,
    address: s.address,
    status: s.status,
    stage_date: s.stage_date,
    destage_date: s.destage_date,
    client_name: s.clients?.name ?? null,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        subtitle="Stage and destage dates by month or week"
        actions={
          <>
            <LinkButton href="/stages/groups" variant="secondary">
              <HomeIcon size={14} /> Stages
            </LinkButton>
            <LinkButton href="/stages/new">
              <PlusCircle size={14} /> New stage
            </LinkButton>
          </>
        }
      />
      {isAdmin && <CalendarEventsAdmin events={customEvents} />}
      <CalendarView
        stages={events}
        events={customEvents}
        isAdmin={isAdmin}
      />
    </div>
  );
}
