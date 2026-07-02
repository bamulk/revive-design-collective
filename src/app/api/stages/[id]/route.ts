import { createClient } from "@/lib/supabase/server";
import { updateStageAction } from "@/app/(app)/stages/actions";

/**
 * Stage update via a plain Route Handler (fetched from StageEditForm)
 * instead of a Server Action.
 *
 * Why: invoking a Server Action from a <form> makes Next re-render the
 * current route as part of the action's response — re-suspending the
 * heavy stage page's sections into their skeletons. That was the post-
 * save "loading screen". A normal fetch() to this handler does the same
 * DB write but never touches the router/RSC, so there's no re-render and
 * no loading screen; the client flips to the read-only view itself.
 *
 * The actual update logic is reused from updateStageAction (called here
 * server-side, so it does not trigger a client refresh).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Auth: admins only (mirrors the edit form's gating). RLS also guards
  // the table, but fail fast with a clean status here.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (me?.role !== "admin") {
    return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const formData = await req.formData();
    await updateStageAction(id, formData);
    return Response.json({ ok: true });
  } catch (err: any) {
    console.error("[api/stages update]", id, err);
    return Response.json(
      { ok: false, error: err?.message || "Update failed" },
      { status: 500 },
    );
  }
}
