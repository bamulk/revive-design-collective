import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updateClientAction, deleteClientAction } from "../actions";
import PortalInviteButton from "@/components/PortalInviteButton";
import ClientStagesCards from "@/components/ClientStagesCards";
import { requireTeamMember } from "@/lib/permissions";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {

  await requireTeamMember();
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  const isAdmin = me?.role === "admin";
  const { data: client } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .single();

  if (!client) notFound();

  const { data: stages } = await supabase
    .from("stages")
    .select(
      "id, address, status, stage_date, destage_date, amount, paid_at, payment_method",
    )
    .eq("client_id", id)
    .order("created_at", { ascending: false });

  const update = updateClientAction.bind(null, id);
  const del = deleteClientAction.bind(null, id);

  return (
    <div className="space-y-8">
      <div>
        <Link href="/clients" className="text-sm text-slate-700 dark:text-slate-300 hover:underline">
          ← All clients
        </Link>
        <h1 className="text-2xl font-semibold mt-1">{client.name}</h1>
      </div>

      <form data-no-loader action={update} className="bg-white dark:bg-slate-900 border rounded-xl p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
        <input name="name" required defaultValue={client.name} className="border rounded px-3 py-2.5 text-base" />
        <input name="email" defaultValue={client.email ?? ""} placeholder="Email" className="border rounded px-3 py-2.5 text-base" />
        <input name="phone" defaultValue={client.phone ?? ""} placeholder="Phone" className="border rounded px-3 py-2.5 text-base" />
        <input name="address" defaultValue={client.address ?? ""} placeholder="Address" className="border rounded px-3 py-2.5 text-base" />
        <textarea name="notes" defaultValue={client.notes ?? ""} placeholder="Notes" className="md:col-span-2 border rounded px-3 py-2.5 text-base" />
        <div className="md:col-span-2 flex flex-col sm:flex-row gap-3">
          <button className="bg-slate-900 text-white rounded-lg px-4 py-2.5">Save</button>
          {/* Deleting a client is admin-only. */}
          {isAdmin && (
            <button formAction={del} className="text-red-600 rounded-lg px-4 py-2.5 border border-red-200">
              Delete
            </button>
          )}
        </div>
      </form>

      {/* Portal access — send the client a one-click sign-in link to
          the client portal. Admin-only (the action requires admin). */}
      {isAdmin && (
        <div className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-2">
          <div>
            <h2 className="text-base font-semibold">Client portal</h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Emails a magic-link sign-in to the client. They can view their
              stages, dates, and payment status — no photos or team info.
            </p>
          </div>
          <PortalInviteButton
            clientId={client.id}
            hasEmail={!!(client.email && client.email.trim())}
          />
        </div>
      )}

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Stages</h2>
          <Link
            href={`/stages/new?client=${client.id}`}
            className="text-sm bg-slate-900 text-white rounded px-3 py-1.5"
          >
            + New stage
          </Link>
        </div>
        <ClientStagesCards stages={(stages ?? []) as any} />
      </section>
    </div>
  );
}
