import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendPushToUser, isPushConfigured } from "@/lib/push";

/**
 * POST /api/push/test — fire a test notification to the calling user.
 * Useful for verifying the push pipeline end-to-end without touching
 * a real stage.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isPushConfigured()) {
    return NextResponse.json(
      { ok: false, error: "VAPID keys not configured on server" },
      { status: 500 },
    );
  }

  const result = await sendPushToUser(user.id, {
    title: "Revive Design Collective",
    body: "Test notification — if you see this, push is working!",
    url: "/",
    tag: "test",
  });
  return NextResponse.json({ ok: true, ...result });
}
