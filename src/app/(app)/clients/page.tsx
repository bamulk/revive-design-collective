import { UserPlus, Merge } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createClientAction } from "./actions";
import { Card, PageHeader, Button, LinkButton } from "@/components/ui";
import ClientsGrid, { type ClientCard } from "@/components/ClientsGrid";
import { requireTeamMember } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  await requireTeamMember();
  const supabase = await createClient();
  const [{ data: clients }, { data: stageRows }] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, email, phone")
      // Alphabetical, case-insensitive. PostgREST honors "order"
      // case-insensitively when the column collation is locale-aware,
      // which clients.name is (text default collation).
      .order("name", { ascending: true }),
    supabase.from("stages").select("client_id"),
  ]);

  const stageCount = new Map<string, number>();
  for (const s of stageRows ?? []) {
    if (!s.client_id) continue;
    stageCount.set(s.client_id, (stageCount.get(s.client_id) ?? 0) + 1);
  }

  const cards: ClientCard[] = (clients ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    stageCount: stageCount.get(c.id) ?? 0,
  }));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Clients"
        subtitle={`${cards.length} total · manage the people you stage for`}
        actions={
          <LinkButton href="/clients/merge" variant="secondary">
            <Merge size={14} /> Merge duplicates
          </LinkButton>
        }
      />

      <Card className="p-5">
        <form
          action={createClientAction}
          className="grid grid-cols-1 md:grid-cols-2 gap-3"
        >
          <h2 className="md:col-span-2 font-medium flex items-center gap-2 text-slate-900 dark:text-slate-100">
            <UserPlus size={16} className="text-brand" />
            Add a client
          </h2>
          <input
            name="name"
            required
            placeholder="Name *"
            className="border rounded-lg px-3 py-2.5 text-base"
          />
          <input
            name="email"
            type="email"
            inputMode="email"
            placeholder="Email"
            className="border rounded-lg px-3 py-2.5 text-base"
          />
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            placeholder="Phone"
            className="border rounded-lg px-3 py-2.5 text-base"
          />
          <input
            name="address"
            placeholder="Address"
            className="border rounded-lg px-3 py-2.5 text-base"
          />
          <textarea
            name="notes"
            placeholder="Notes"
            rows={2}
            className="md:col-span-2 border rounded-lg px-3 py-2.5 text-base"
          />
          <div className="md:col-span-2">
            <Button>Save client</Button>
          </div>
        </form>
      </Card>

      <ClientsGrid clients={cards} />
    </div>
  );
}
