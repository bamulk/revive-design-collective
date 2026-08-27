"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/require-admin";

/**
 * Email the client a magic-link sign-in for the portal. Admin-only.
 * No-ops cleanly if the client has no email on file.
 */
export async function sendPortalLinkAction(
  clientId: string,
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: client, error: lookupErr } = await supabase
    .from("clients")
    .select("email")
    .eq("id", clientId)
    .single();
  if (lookupErr || !client) {
    return { ok: false, error: "Client not found." };
  }
  const email = (client.email ?? "").trim();
  if (!email) {
    return { ok: false, error: "No email on file for this client." };
  }

  // Token-hash magic link emailed via Resend — works in any browser,
  // including links opened from an email app's in-app browser (PKCE
  // links don't, since the verifier lives only in the requesting
  // browser).
  const { sendPortalMagicLink } = await import("@/lib/portal-link");
  const res = await sendPortalMagicLink(email);
  if (!res.ok) return res;
  return { ok: true, email };
}

export async function createClientAction(formData: FormData) {
  const supabase = await createClient();
  const payload = {
    name: String(formData.get("name") || "").trim(),
    email: String(formData.get("email") || "").trim() || null,
    phone: (formData.get("phone") as string) || null,
    address: (formData.get("address") as string) || null,
    notes: (formData.get("notes") as string) || null,
  };
  if (!payload.name) throw new Error("Name is required");
  const { error } = await supabase.from("clients").insert(payload);
  if (error) throw new Error(error.message);
  revalidatePath("/clients");
  redirect("/clients");
}

export async function updateClientAction(id: string, formData: FormData) {
  const supabase = await createClient();
  const payload = {
    name: String(formData.get("name") || "").trim(),
    email: String(formData.get("email") || "").trim() || null,
    phone: (formData.get("phone") as string) || null,
    address: (formData.get("address") as string) || null,
    notes: (formData.get("notes") as string) || null,
    // Checked box = "don't nag this client" = reminders OFF.
    payment_reminders: formData.get("no_payment_reminders") !== "on",
  };
  const { error } = await supabase.from("clients").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/clients/${id}`);
  revalidatePath("/clients");
}

export async function deleteClientAction(id: string) {
  // Deleting a client is admin-only (stagers/lead stagers can view + edit
  // clients but not delete them).
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/clients");
  redirect("/clients");
}

/**
 * Merge one or more "loser" clients into a "keep" client:
 *
 * 1. Reassign every stage on a loser to the keeper.
 * 2. Backfill the keeper's contact fields (email/phone/address) from the
 *    losers when the keeper has them empty.
 * 3. Append loser notes onto the keeper.
 * 4. Delete the losers.
 *
 * Idempotent — re-running with the same args after a successful merge is
 * a no-op (the losers are gone).
 */
export async function mergeClientsAction(
  keepId: string,
  loserIds: string[]
): Promise<void> {
  if (!keepId) throw new Error("Pick a client to keep");
  const ids = loserIds.filter((id) => id && id !== keepId);
  if (ids.length === 0) throw new Error("Pick at least one client to merge in");

  const supabase = await createClient();

  const { data: rows, error: fetchErr } = await supabase
    .from("clients")
    .select("id, name, email, phone, address, notes")
    .in("id", [keepId, ...ids]);
  if (fetchErr) throw new Error(fetchErr.message);

  const keep = rows?.find((r) => r.id === keepId);
  const losers = rows?.filter((r) => ids.includes(r.id)) ?? [];
  if (!keep) throw new Error("Keep client not found");

  // Backfill any blank field on the keeper from a loser that has it.
  const fields = ["email", "phone", "address"] as const;
  const patch: Record<string, string> = {};
  for (const f of fields) {
    if (!keep[f]) {
      const filled = losers.find((l) => l[f])?.[f];
      if (filled) patch[f] = filled;
    }
  }
  // Append any loser notes so they aren't dropped.
  const loserNotes = losers
    .map((l) => l.notes?.trim())
    .filter(Boolean)
    .join("\n");
  if (loserNotes) {
    patch.notes = keep.notes ? `${keep.notes}\n${loserNotes}` : loserNotes;
  }
  if (Object.keys(patch).length > 0) {
    const { error: updErr } = await supabase
      .from("clients")
      .update(patch)
      .eq("id", keepId);
    if (updErr) throw new Error(updErr.message);
  }

  // Move every stage from the losers onto the keeper.
  const { error: stageErr } = await supabase
    .from("stages")
    .update({ client_id: keepId })
    .in("client_id", ids);
  if (stageErr) throw new Error(stageErr.message);

  // Delete the losers.
  const { error: delErr } = await supabase
    .from("clients")
    .delete()
    .in("id", ids);
  if (delErr) throw new Error(delErr.message);

  revalidatePath("/clients");
  revalidatePath("/clients/merge");
  revalidatePath(`/clients/${keepId}`);
}
