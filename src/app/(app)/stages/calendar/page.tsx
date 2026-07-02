import { PlusCircle, Home as HomeIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, LinkButton } from "@/components/ui";
import CalendarView, { type CalendarStage } from "./CalendarView";

export const dynamic = "force-dynamic";

/**
 * Calendar page: shows every stage_date and destage_date as colored
 * pills on a month grid or week list. Cancelled stages are excluded.
 */
export default async function CalendarPage() {
  const supabase = await createClient();
  const { data: stages } = await supabase
    .from("stages")
    .select("id, address, status, stage_date, destage_date, clients(name)")
    .not("status", "in", "(cancelled,estimate)");

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
      <CalendarView stages={events} />
    </div>
  );
}
