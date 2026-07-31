import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, isEmailConfigured } from "@/lib/email-send";
import { newExtensionToken } from "@/lib/extension-core";
import { emailButton } from "@/lib/email-button";
import { todayPacificISO, addDaysISO, formatMDY } from "@/lib/time";

const APP_NAME = "Revive Design Collective";

/**
 * Daily cron — emails clients 10 days before their destage_date asking
 * if they want to extend 30 more days or schedule the destage.
 *
 * Vercel cron auth: the `CRON_SECRET` env var must match the
 * Authorization bearer token Vercel sends.
 */
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!isEmailConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Email isn't configured" },
      { status: 500 },
    );
  }

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  if (!baseUrl) {
    return NextResponse.json(
      { ok: false, error: "NEXT_PUBLIC_APP_URL not set" },
      { status: 500 },
    );
  }

  // Find stages whose destage_date is exactly 10 days out.
  const target = addDaysISO(todayPacificISO(), 10);
  const supabase = createAdminClient();
  const { data: stages, error } = await supabase
    .from("stages")
    .select(
      "id, address, city, stage_date, destage_date, extension_token, clients(name, email)",
    )
    .eq("status", "staged")
    .eq("destage_date", target)
    .is("extension_email_sent_at", null);

  if (error) {
    console.error("[cron/extension-reminders] query error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // BCC every admin on the renewal offers so the office always sees
  // exactly what went out to whom (same pattern as invoice/estimate
  // emails).
  const { data: admins } = await supabase
    .from("profiles")
    .select("email")
    .eq("role", "admin");
  const adminEmails = (admins ?? [])
    .map((a: any) => a.email as string | null)
    .filter((e): e is string => !!e)
    .slice(0, 50);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const s of (stages ?? []) as any[]) {
    const clientEmail = s.clients?.email as string | undefined;
    if (!clientEmail) {
      // No email — log + stamp so we don't keep retrying every day.
      await supabase
        .from("stages")
        .update({ extension_email_sent_at: new Date().toISOString() })
        .eq("id", s.id);
      skipped += 1;
      continue;
    }

    // Generate a fresh token if one isn't already on file.
    let token = s.extension_token;
    if (!token) {
      token = newExtensionToken();
      const { error: tokErr } = await supabase
        .from("stages")
        .update({ extension_token: token })
        .eq("id", s.id);
      if (tokErr) {
        console.error("[cron/extension-reminders] token write failed:", tokErr);
        failed += 1;
        continue;
      }
    }

    const link = `${baseUrl}/x/${token}`;
    const firstName =
      (s.clients?.name || "there").split(" ")[0] || "there";
    const subject = `Action needed: staging at ${s.address}`;
    const text = `Hi ${firstName},

Your staging at ${s.address} is scheduled to be removed on ${formatMDY(s.destage_date)} (10 days from today).

If you'd like to keep the staging in place for another 30 days, the extension is $50%* of your original invoice. Otherwise we'll come pick everything up on the scheduled day.

Let us know which you'd prefer:
${link}

* For example, if your original invoice was $2,000, the 30-day extension would be $1,000.

— Revive Design Collective`;
    const html = `<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; line-height:1.5; color:#0f172a; max-width:560px; margin:0 auto; padding:24px;">
  <p>Hi ${firstName},</p>
  <p>Your staging at <strong>${s.address}</strong> is scheduled to be removed on
  <strong>${formatMDY(s.destage_date)}</strong> (10 days from today).</p>
  <p>If you'd like to <strong>keep the staging</strong> for another 30 days, the extension is <strong>50%</strong> of your original invoice. Otherwise we'll come pick everything up on the scheduled day.</p>
  ${emailButton({ href: link, label: "Choose extend or destage" })}
  <p style="font-size:13px; color:#64748b;">If the button doesn't work, copy and paste this link:<br/><span style="word-break:break-all;">${link}</span></p>
  <hr style="border:none; border-top:1px solid #e2e8f0; margin:24px 0;" />
  <p style="font-size:12px; color:#94a3b8;">Revive Design Collective</p>
</body></html>`;

    const bcc = adminEmails.filter((e) => e !== clientEmail);
    try {
      await sendEmail({
        to: clientEmail,
        ...(bcc.length > 0 ? { bcc } : {}),
        subject,
        text,
        html,
      });
      await supabase
        .from("stages")
        .update({ extension_email_sent_at: new Date().toISOString() })
        .eq("id", s.id);
      sent += 1;
    } catch (e: any) {
      console.error(`[cron/extension-reminders] send to ${clientEmail} failed:`, e);
      failed += 1;
    }
  }

  console.log("[cron/extension-reminders]", { target, sent, skipped, failed });
  return NextResponse.json({ ok: true, target, sent, skipped, failed });
}
