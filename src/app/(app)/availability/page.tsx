import { Card, PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { requireTeamMember } from "@/lib/permissions";
import { todayPacificISO, addDaysISO, APP_TZ } from "@/lib/time";
import AvailabilityCalendar, {
  type AvailabilityDay,
} from "@/components/AvailabilityCalendar";
import StagerAvailabilityPicker, {
  type PickerStager,
} from "@/components/StagerAvailabilityPicker";

export const dynamic = "force-dynamic";

const HORIZON_DAYS = 28; // four weeks out

/** Build the 4-week day list (shared by self + admin views). */
function buildDays(): AvailabilityDay[] {
  const todayISO = todayPacificISO();
  const days: AvailabilityDay[] = [];
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const iso = addDaysISO(todayISO, i);
    const d = new Date(iso + "T12:00:00Z");
    const weekday = d.toLocaleDateString("en-US", {
      weekday: "short",
      timeZone: APP_TZ,
    });
    days.push({
      date: iso,
      weekdayIndex: d.getUTCDay(),
      weekday,
      label: d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: APP_TZ,
      }),
      week: Math.floor(i / 7),
      isWeekend: weekday === "Sat" || weekday === "Sun",
    });
  }
  return days;
}

async function loadSchedule(
  supabase: Awaited<ReturnType<typeof createClient>>,
  stagerId: string,
): Promise<{ weekly: number[]; overrides: { date: string; available: boolean }[] }> {
  const todayISO = todayPacificISO();
  const lastISO = addDaysISO(todayISO, HORIZON_DAYS - 1);
  const [{ data: weeklyRows }, { data: overrideRows }] = await Promise.all([
    supabase
      .from("stager_weekly_availability")
      .select("weekday")
      .eq("stager_id", stagerId),
    supabase
      .from("stager_availability")
      .select("date, available")
      .eq("stager_id", stagerId)
      .gte("date", todayISO)
      .lte("date", lastISO),
  ]);
  return {
    weekly: (weeklyRows ?? []).map((r: { weekday: number }) => r.weekday),
    overrides: (overrideRows ?? []).map(
      (r: { date: string; available: boolean }) => ({
        date: r.date,
        available: r.available,
      }),
    ),
  };
}

/**
 * Availability page.
 *  - Stagers / lead stagers edit their OWN recurring weekly schedule +
 *    per-day overrides.
 *  - Admins don't keep their own availability; instead they get a stager
 *    picker and edit the selected stager's schedule on their behalf.
 */
export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ stager?: string }>;
}) {
  const { userId } = await requireTeamMember();
  const supabase = await createClient();
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();
  const isAdmin = me?.role === "admin";
  const days = buildDays();

  // ---- Stager / lead-stager: edit your own ----
  if (!isAdmin) {
    const { weekly, overrides } = await loadSchedule(supabase, userId);
    return (
      <div className="space-y-6">
        <PageHeader
          title="My availability"
          subtitle="Set your weekly schedule once. Your team admins use this to assign jobs."
        />
        <Card className="p-4">
          <AvailabilityCalendar
            days={days}
            initialWeekly={weekly}
            initialOverrides={overrides}
          />
        </Card>
      </div>
    );
  }

  // ---- Admin: manage a stager's availability ----
  const { data: stagerRows } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("role", ["stager", "lead_stager"])
    .order("full_name", { ascending: true, nullsFirst: false });

  const stagers: PickerStager[] = (stagerRows ?? []).map((p: any) => {
    const full = (p.full_name ?? "").trim();
    const emailLocal = (p.email ?? "").split("@")[0] || "Unnamed";
    return { id: p.id, name: full || emailLocal };
  });

  const { stager: requested } = await searchParams;
  const selectedId =
    requested && stagers.some((s) => s.id === requested) ? requested : null;
  const selected = stagers.find((s) => s.id === selectedId) ?? null;

  const schedule = selectedId
    ? await loadSchedule(supabase, selectedId)
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stager availability"
        subtitle="Set and edit when your stagers are available."
      />
      <Card className="p-4 space-y-4">
        <StagerAvailabilityPicker stagers={stagers} selectedId={selectedId} />
        {stagers.length === 0 ? (
          <p className="text-sm italic text-slate-500 dark:text-slate-400">
            No stagers in the roster yet.
          </p>
        ) : !selected || !schedule ? (
          <p className="text-sm italic text-slate-500 dark:text-slate-400">
            Pick a stager above to view and edit their availability.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {selected.name}
            </div>
            <AvailabilityCalendar
              key={selected.id}
              days={days}
              initialWeekly={schedule.weekly}
              initialOverrides={schedule.overrides}
              targetStagerId={selected.id}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
