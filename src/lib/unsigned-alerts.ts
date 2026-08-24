/**
 * Day-before unsigned-agreement alert, run daily from
 * /api/cron/reminders (9am Pacific).
 *
 * Finds every stage whose stage_date is TOMORROW where the staging
 * agreement hasn't been signed (signature_completed_at null — covers
 * both "agreement sent, client hasn't signed" and "no agreement ever
 * sent") and emails ALL admins one digest. Without this, an unsigned
 * stage slips straight into staging — and since invoicing is gated on
 * the signature, it then never gets invoiced or reminded either.
 *
 * Skips: $0 internal stages (never billed, no agreement expected),
 * cancelled/estimate rows, and stages already alerted
 * (unsigned_alert_sent_at stamp — one alert per stage, ever).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, isEmailConfigured } from "@/lib/email-send";
import { todayPacificISO, addDaysISO, formatMDY } from "@/lib/time";

export type UnsignedAlertResult = {
  flagged: number;
  emailed: boolean;
  errors: number;
  aborted?: string;
};

export async function runUnsignedContractCheck(): Promise<UnsignedAlertResult> {
  const result: UnsignedAlertResult = {
    flagged: 0,
    emailed: false,
    errors: 0,
  };
  if (!isEmailConfigured()) {
    result.aborted = "email not configured";
    return result;
  }

  const admin = createAdminClient();
  const tomorrow = addDaysISO(todayPacificISO(), 1);

  const { data: stages, error } = await admin
    .from("stages")
    .select(
      "id, address, city, stage_date, amount, signature_envelope_id, clients(name)",
    )
    .eq("stage_date", tomorrow)
    .is("signature_completed_at", null)
    .is("unsigned_alert_sent_at", null)
    .gt("amount", 0)
    .in("status", ["scheduled", "staged"]);
  if (error) {
    result.aborted = `stages query failed: ${error.message}`;
    return result;
  }
  const flagged = (stages ?? []) as any[];
  result.flagged = flagged.length;
  if (flagged.length === 0) return result;

  const { data: admins, error: adminsErr } = await admin
    .from("profiles")
    .select("email")
    .eq("role", "admin");
  if (adminsErr) {
    result.aborted = `admins query failed: ${adminsErr.message}`;
    return result;
  }
  const adminEmails = (admins ?? [])
    .map((a: any) => a.email as string | null)
    .filter((e): e is string => !!e)
    .slice(0, 50);
  if (adminEmails.length === 0) {
    result.aborted = "no admin emails on file";
    return result;
  }

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const lines = flagged.map((s) => {
    const client = Array.isArray(s.clients) ? s.clients[0] : s.clients;
    const state = s.signature_envelope_id
      ? "agreement sent — NOT signed"
      : "no agreement ever sent";
    return { s, client, state };
  });

  const subject =
    flagged.length === 1
      ? `⚠️ Staging tomorrow without a signed agreement: ${flagged[0].address}`
      : `⚠️ ${flagged.length} stages tomorrow without a signed agreement`;

  const text =
    `These stages are scheduled for TOMORROW (${formatMDY(tomorrow)}) ` +
    `but the staging agreement hasn't been signed:\n\n` +
    lines
      .map(
        ({ s, client, state }) =>
          `- ${s.address}${s.city ? `, ${s.city}` : ""} — ${
            client?.name ?? "no client"
          } — $${Number(s.amount ?? 0).toFixed(2)} — ${state}` +
          (baseUrl ? `\n  ${baseUrl}/stages/${s.id}` : ""),
      )
      .join("\n") +
    `\n\nUnsigned stages never get invoiced (invoicing is gated on the ` +
    `signature), so chase the signature or handle it manually before ` +
    `the crew goes out.\n\n— Revive Design Collective`;

  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; color: #0f172a; max-width: 560px; margin: 0 auto;">
      <p><strong>These stages are scheduled for TOMORROW (${formatMDY(
        tomorrow,
      )})</strong> but the staging agreement hasn't been signed:</p>
      ${lines
        .map(
          ({ s, client, state }) => `
      <div style="border:1px solid #fecaca; background:#fef2f2; border-radius:10px; padding:14px 16px; margin:10px 0;">
        <div style="font-weight:600;">${s.address}${s.city ? `, ${s.city}` : ""}</div>
        <div style="font-size:14px; color:#475569;">${client?.name ?? "no client"} &middot; $${Number(
          s.amount ?? 0,
        ).toFixed(2)}</div>
        <div style="font-size:14px; color:#b91c1c; margin:6px 0 ${baseUrl ? "10px" : "0"};">${state}</div>
        ${
          baseUrl
            ? `<a href="${baseUrl}/stages/${s.id}" style="display:inline-block; padding:8px 14px; background:#0f172a; border-radius:8px; color:#ffffff; font-weight:600; text-decoration:none; font-size:13px;">Open stage</a>`
            : ""
        }
      </div>`,
        )
        .join("")}
      <p style="color:#475569; font-size: 14px;">
        Unsigned stages never get invoiced (invoicing is gated on the
        signature), so chase the signature or handle it manually before
        the crew goes out.
      </p>
      <p style="color:#475569; font-size: 14px;">— Revive Design Collective</p>
    </div>
  `;

  try {
    await sendEmail({
      to: adminEmails[0],
      ...(adminEmails.length > 1 ? { cc: adminEmails.slice(1) } : {}),
      subject,
      text,
      html,
    });
    result.emailed = true;
  } catch (e) {
    result.errors += 1;
    console.error("[unsigned-alerts] send failed:", e);
    return result; // nothing stamped — retries on the next run
  }

  // Stamp each alerted stage (checked) so tomorrow's run can't re-send.
  for (const s of flagged) {
    const { error: stampErr } = await admin
      .from("stages")
      .update({ unsigned_alert_sent_at: new Date().toISOString() })
      .eq("id", s.id);
    if (stampErr) {
      result.errors += 1;
      console.error(
        "[unsigned-alerts] stamp failed (may re-alert):",
        s.id,
        stampErr.message,
      );
    }
  }
  return result;
}
