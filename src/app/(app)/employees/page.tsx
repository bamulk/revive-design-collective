import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/require-admin";
import { formatMDY } from "@/lib/time";
import RemoveEmployeeButton from "@/components/RemoveEmployeeButton";
import {
  inviteEmployeeAction,
  updateEmployeeRoleAction,
  deleteEmployeeAction,
  resendInviteAction,
} from "./actions";

export default async function EmployeesPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (me?.role !== "admin") {
    return <p className="text-slate-600 dark:text-slate-400">Admin only.</p>;
  }

  const { data: employees } = await supabase
    .from("profiles")
    .select(
      "id, full_name, email, role, phone, sms_notifications_enabled, created_at",
    )
    .order("created_at", { ascending: true });

  // Pull the auth-side state for each profile so we can show whether
  // the invite was actually accepted. The admin client lists all
  // users (paginated 1000 at a time — fine for a small team).
  const admin = createAdminClient();
  const authMap = new Map<
    string,
    { email_confirmed_at: string | null; last_sign_in_at: string | null }
  >();
  try {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of list?.users ?? []) {
      authMap.set(u.id, {
        email_confirmed_at: u.email_confirmed_at ?? null,
        last_sign_in_at: u.last_sign_in_at ?? null,
      });
    }
  } catch (err) {
    console.error("[employees] listUsers failed:", err);
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Team</h1>

      <form
        data-no-loader
        action={inviteEmployeeAction}
        className="bg-white dark:bg-slate-900 border rounded-xl p-5 grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
      >
        <label className="text-sm md:col-span-1">
          Full name
          <input name="full_name" className="mt-1 w-full border rounded px-3 py-2.5 text-base" />
        </label>
        <label className="text-sm md:col-span-1">
          Email *
          <input name="email" type="email" required className="mt-1 w-full border rounded px-3 py-2.5 text-base" />
        </label>
        <label className="text-sm md:col-span-1">
          Role
          <select name="role" defaultValue="stager" className="mt-1 w-full border rounded px-3 py-2.5 text-base">
            <option value="stager">Stager</option>
            <option value="lead_stager">Lead Stager</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button className="bg-slate-900 text-white rounded-lg px-4 py-2.5 w-full md:w-auto">Invite</button>
      </form>

      {/*
        Mobile-first card list. Each user is a <details> accordion,
        collapsed by default so the page stays scannable at a glance.
        The summary shows name + email + status. Editing happens in
        the panel that opens below.

        Single-form pattern: name + phone + role + SMS toggle all live
        in one <form> so a single "Save" commits everything. Earlier
        each field had its own form, and saving one wiped out the
        others' defaults.
      */}
      <div className="space-y-2">
        {(employees ?? []).map((e) => {
          const update = updateEmployeeRoleAction.bind(null, e.id);
          const del = deleteEmployeeAction.bind(null, e.id);
          const resend = resendInviteAction.bind(null, e.id);
          const auth = authMap.get(e.id);
          const accepted = !!auth?.email_confirmed_at;
          const lastSeen = auth?.last_sign_in_at ?? null;
          return (
            <details
              key={e.id}
              className="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden [&_summary]:list-none [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="cursor-pointer select-none p-4 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 flex items-center gap-2">
                    {/* Chevron — rotates when open */}
                    <svg
                      aria-hidden
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="w-4 h-4 text-slate-500 dark:text-slate-400 transition-transform group-open:rotate-90 shrink-0"
                    >
                      <path
                        fillRule="evenodd"
                        d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                        {e.full_name?.trim() || e.email}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {e.email}
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0">
                    {accepted ? (
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-200 dark:ring-emerald-900/50">
                          ● Active
                        </span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          {lastSeen
                            ? `Last sign in ${formatMDY(lastSeen)}`
                            : "Not signed in yet"}
                        </span>
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 ring-1 ring-inset ring-amber-200 dark:ring-amber-900/50">
                        ◌ Pending invite
                      </span>
                    )}
                  </div>
                </div>
              </summary>

              {/* Expanded panel: editor form + resend (pending only) + remove */}
              <div className="border-t border-slate-100 dark:border-slate-800 p-4 space-y-3">
                {!accepted && (
                  <form data-no-loader action={resend} className="flex">
                    <button
                      type="submit"
                      className="text-xs underline text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                    >
                      Resend invite
                    </button>
                  </form>
                )}

                {/* Editable fields — one form so every field is sent
                    together on Save. */}
                <form
                  data-no-loader
                  action={update}
                  className="grid grid-cols-1 sm:grid-cols-2 gap-3"
                >
                <label className="block text-xs text-slate-600 dark:text-slate-400">
                  Name
                  <input
                    name="full_name"
                    defaultValue={e.full_name ?? ""}
                    className="mt-1 w-full border rounded px-3 py-2 text-base"
                    placeholder="Full name"
                  />
                </label>

                <label className="block text-xs text-slate-600 dark:text-slate-400">
                  Role
                  <select
                    name="role"
                    defaultValue={e.role}
                    className="mt-1 w-full border rounded px-3 py-2 text-base"
                  >
                    <option value="stager">Stager</option>
                    <option value="lead_stager">Lead Stager</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>

                <label className="block text-xs text-slate-600 dark:text-slate-400 sm:col-span-2">
                  Phone
                  <input
                    name="phone"
                    defaultValue={e.phone ?? ""}
                    placeholder="(555) 123-4567"
                    className="mt-1 w-full border rounded px-3 py-2 text-base"
                  />
                </label>

                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 sm:col-span-2 cursor-pointer">
                  <input
                    type="checkbox"
                    name="sms_notifications_enabled"
                    defaultChecked={e.sms_notifications_enabled !== false}
                    className="h-4 w-4 accent-brand"
                  />
                  Push notifications
                </label>

                <div className="sm:col-span-2 flex items-center justify-between gap-2 pt-1">
                  <button
                    type="submit"
                    className="inline-flex items-center text-sm bg-slate-900 hover:bg-slate-800 text-white rounded-lg px-4 py-2"
                  >
                    Save
                  </button>
                </div>
              </form>

                {/* Destructive action lives in its own form so the
                    primary Save button can't accidentally trigger it.
                    Lives in a small client component because we want a
                    confirm() prompt before posting. */}
                <RemoveEmployeeButton
                  action={del}
                  label={e.full_name?.trim() || e.email || "this user"}
                />
              </div>
            </details>
          );
        })}
        {(!employees || employees.length === 0) && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 text-center text-sm text-slate-500 dark:text-slate-400">
            No team members yet. Send the first invite above.
          </div>
        )}
      </div>
    </div>
  );
}
