// SignatureAPI webhook receiver.
//
// Configure this URL in the SignatureAPI dashboard (e.g.
// https://your-app.com/api/signatures/webhook). On envelope.completed we
// download the signed PDF, cache it in Supabase Storage, and stamp the stage.
//
// The exact JSON shape SignatureAPI sends isn't fully documented in what I
// have access to, so we read defensively: we look for a status/event string
// and an envelope id in common locations and treat anything containing
// "complete" or "signed" as completion.

import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { downloadSignedPdf, getEnvelope } from "@/lib/signature";
import { generateInvoiceFor } from "@/lib/invoice-generate-core";
import { sendInvoiceEmailFor } from "@/lib/invoice-email-core";

export const runtime = "nodejs";

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service credentials missing");
  return createAdminClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  // Optional shared-secret check — set SIGNATURE_WEBHOOK_SECRET in env and
  // configure the matching value on SignatureAPI's webhook.
  const expected = process.env.SIGNATURE_WEBHOOK_SECRET;
  if (expected) {
    const provided =
      req.headers.get("x-signature-secret") ||
      req.headers.get("x-webhook-secret") ||
      body.secret;
    if (provided !== expected) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  // SignatureAPI documents `type` as the canonical event name (e.g.
  // "envelope.completed"). Older or fan-out payloads may also include
  // event / status / envelope.status. We collect every signal we can
  // find and treat the envelope as completed when any of them say so.
  const signals: string[] = [
    body.event,
    body.type,
    body.status,
    body.envelope?.status,
    body.data?.status,
    body.data?.envelope?.status,
    body.data?.object_status,
  ]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase());

  // SignatureAPI uses prefixed IDs for non-envelope objects (re_, del_,
  // ev_…) and UUIDs for envelopes. Pick the first value that actually
  // looks like a UUID so we don't accidentally call GET /v1/envelopes/
  // with a recipient or event id (which 404s).
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const candidates: (string | undefined)[] = [
    body.envelope_id,
    body.envelopeId,
    body.envelope?.id,
    body.data?.envelope_id,
    body.data?.envelopeId,
    body.data?.envelope?.id,
    body.data?.envelope, // some payloads inline the id as a bare string
    body.object?.envelope_id,
    body.object?.envelope?.id,
    // Fall through to .id last, since on many event payloads .id is the
    // event id, not the envelope id.
    body.envelope?.envelope_id,
    body.data?.object_id,
    body.data?.id,
    body.id,
  ];
  const envelopeId = candidates
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .find((v) => UUID_RE.test(v));

  console.log("[signature webhook]", {
    signals,
    envelopeId,
    bodyKeys: Object.keys(body || {}),
    dataKeys: body?.data ? Object.keys(body.data) : null,
    candidates: candidates.filter(Boolean),
  });

  if (!envelopeId) {
    console.warn(
      "[signature webhook] no UUID envelope id in payload; skipping.",
      "Top-level keys:",
      Object.keys(body || {}),
      "data keys:",
      body?.data ? Object.keys(body.data) : "(no .data)",
      "raw data preview:",
      JSON.stringify(body?.data ?? body).slice(0, 800)
    );
    return NextResponse.json({ ok: true, skipped: "no envelope id" });
  }

  const sb = admin();
  const event = signals.find((s) => s.includes(".")) || signals[0] || "";

  // Re-fetch the envelope from SignatureAPI for ground truth — webhook
  // payloads often arrive while the envelope-level status still says
  // in_progress, even when all recipients are completed.
  let envelopeStatus = "";
  let recipientsAllDone = false;
  try {
    const envelope = await getEnvelope(envelopeId);
    envelopeStatus = String(envelope.status || "").toLowerCase();
    const recipientsRaw = (envelope as unknown as { recipients?: unknown })
      .recipients;
    const recipients: { status?: string; type?: string }[] = Array.isArray(
      recipientsRaw
    )
      ? (recipientsRaw as { status?: string; type?: string }[])
      : [];
    const signers = recipients.filter(
      (r) => !r.type || r.type === "signer" || r.type === "approver"
    );
    recipientsAllDone =
      signers.length > 0 &&
      signers.every(
        (r) => String(r.status || "").toLowerCase() === "completed"
      );
    console.log("[signature webhook] envelope refetch:", {
      envelopeStatus,
      recipientsAllDone,
      recipientCount: signers.length,
    });
  } catch (e) {
    console.warn(
      "[signature webhook] envelope refetch failed:",
      (e as Error)?.message ?? e
    );
  }

  const isCompleted =
    envelopeStatus === "completed" ||
    envelopeStatus.includes("complete") ||
    recipientsAllDone ||
    signals.some(
      (s) =>
        s === "completed" ||
        s === "signed" ||
        s === "envelope.completed" ||
        s === "recipient.completed" ||
        s.endsWith(".completed")
    );

  const update: Record<string, unknown> = {
    signature_status: event || "updated",
  };

  if (isCompleted) {
    update.signature_status = "signed";
    update.signature_completed_at = new Date().toISOString();

    // Cache the signed PDF in our storage so it stays accessible even if
    // SignatureAPI retention expires.
    try {
      const bytes = await downloadSignedPdf(envelopeId);
      if (bytes) {
        const path = `signed/${envelopeId}.pdf`;
        await sb.storage.from("contracts").upload(path, bytes, {
          contentType: "application/pdf",
          upsert: true,
        });
        const { data: urlData } = sb.storage
          .from("contracts")
          .getPublicUrl(path);
        update.signed_pdf_url = urlData.publicUrl;
      }
    } catch (e) {
      console.error("Signed PDF download failed:", e);
    }
  }

  // Find the stage first so we can target the auto-invoice and decide
  // whether one is already on file.
  const { data: stageRow, error: lookupErr } = await sb
    .from("stages")
    .select("id, invoice_pdf_url, invoice_sent_at")
    .eq("signature_envelope_id", envelopeId)
    .single();
  if (lookupErr || !stageRow) {
    console.warn(
      "[signature webhook] no stage matched envelope id",
      envelopeId,
      "— ignoring event"
    );
    return NextResponse.json({ ok: true, skipped: "no matching stage" });
  }

  const { error } = await sb
    .from("stages")
    .update(update)
    .eq("id", stageRow.id);
  if (error) {
    console.error("[signature webhook] stage update failed:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  // Auto-generate AND email the invoice the moment the signature
  // lands. Skip re-generation when one is already on file (don't
  // blow away a manually-attached PDF) but still send the email if
  // it hasn't been sent yet — so admins always get their BCC'd
  // record.
  if (isCompleted) {
    try {
      if (!stageRow.invoice_pdf_url) {
        await generateInvoiceFor(sb, stageRow.id);
        console.log(
          "[signature webhook] auto-invoice generated for stage",
          stageRow.id,
        );
      }
      // ATOMIC CLAIM — SignatureAPI commonly fires multiple completion
      // events for the same envelope (recipient.completed +
      // envelope.completed + occasional retries). Each lands in its
      // own concurrent function instance. A simple "read then check"
      // guard isn't enough — both instances see invoice_sent_at as
      // null and both fire sendInvoiceEmailFor, double-emailing the
      // client.
      //
      // Instead: try to stamp invoice_sent_at to "now" with a
      // WHERE invoice_sent_at IS NULL condition. Whoever wins the
      // race (the DB resolves the conflict for us) gets a row back;
      // the loser gets nothing and skips the send. If our send then
      // fails, we clear the stamp so a manual retry can proceed.
      const claimAt = new Date().toISOString();
      const { data: claimed, error: claimErr } = await sb
        .from("stages")
        .update({ invoice_sent_at: claimAt })
        .eq("id", stageRow.id)
        .is("invoice_sent_at", null)
        .select("id");
      if (claimErr) {
        console.warn(
          "[signature webhook] auto-invoice claim failed:",
          claimErr.message,
        );
      } else if (!claimed || claimed.length === 0) {
        console.log(
          "[signature webhook] auto-invoice already claimed by another handler — skipping",
          stageRow.id,
        );
      } else {
        const r = await sendInvoiceEmailFor(sb, stageRow.id);
        if (r.ok) {
          console.log(
            "[signature webhook] auto-invoice email sent for stage",
            stageRow.id,
            "messageId=",
            r.messageId,
          );
        } else {
          console.warn(
            "[signature webhook] auto-invoice email failed:",
            r.error,
          );
          // Release the claim so a manual retry can proceed.
          await sb
            .from("stages")
            .update({ invoice_sent_at: null })
            .eq("id", stageRow.id)
            .eq("invoice_sent_at", claimAt);
        }
      }
    } catch (e) {
      console.warn(
        "[signature webhook] auto-invoice flow failed:",
        (e as Error)?.message ?? e,
      );
    }
  }

  return NextResponse.json({
    ok: true,
    stage_id: stageRow.id,
    completed: isCompleted,
    envelope_status: envelopeStatus || null,
  });
}
