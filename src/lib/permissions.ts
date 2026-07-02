import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Every role on the team. Add new ones here AND keep the DB
 * `is_internal_user()` SECURITY DEFINER in sync (migration 038).
 */
export const TEAM_ROLES = ["admin", "stager", "lead_stager"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

/** Roles that can create / view / edit estimates. */
export const ESTIMATE_ROLES: ReadonlyArray<TeamRole> = ["admin", "lead_stager"];

export function isTeamRole(r: unknown): r is TeamRole {
  return typeof r === "string" && (TEAM_ROLES as readonly string[]).includes(r);
}

export function canEstimate(role: string | null | undefined): boolean {
  return !!role && (ESTIMATE_ROLES as readonly string[]).includes(role);
}

/**
 * Server-side guard for estimate-only pages + actions. Admins and Lead
 * Stagers pass; everyone else gets bounced. Mirrors `requireAdmin()`'s
 * shape so the call sites read the same.
 */
export async function requireEstimateAccess(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!canEstimate(me?.role ?? null)) redirect("/");
}

/**
 * Server-side guard for internal-team pages/actions (admin, stager,
 * lead_stager). Portal clients have no `profiles` row, so they're
 * bounced. Returns the signed-in user's id for convenience.
 */
export async function requireTeamMember(): Promise<{ userId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!isTeamRole(me?.role)) redirect("/");
  return { userId: user.id };
}
