/**
 * Unpaid-invoice email reminders, run daily from /api/cron/reminders.
 *
 * Cadence (stage invoices and 30-day extension invoices alike):
 *   - first reminder 5 days after the invoice email went out
 *   - then every 3 days while it stays unpaid
 * (Timing checks allow 12h of slack so a daily cron never drifts a
 * reminder from day 3 to day 4.)
 *
 * ONE DIGEST EMAIL PER (CLIENT, SECONDARY-RECIPIENT) PER RUN: open
 * invoices that share the same parties are combined into one email.
 * Secondary recipients are per-stage, so an invoice with a different
 * secondary goes in its OWN email CC'd only to that address — a CC'd
 * party must never see another transaction's invoice (this leaked
 * across two clients' digests on 2026-08-09/10 when grouping was
 * purely per-client).
 *
 * Skipped when:
 *   - the client's payment_reminders checkbox is off (escrow payers)
 *   - the stage itself is flagged "Paying through escrow"
 *   - the invoice email was never sent (nothing to remind about)
 *   - there's no invoice PDF to link (counted + reported, not emailed)
 *   - the client has no email on file
 *   - the stage is cancelled / an estimate / a $0 internal stage
 *
 * Fail-closed: any query error aborts the pass — better to send
 * nothing than to email a wrong balance. Every send stamps
 * *_reminder_last_at/count per item (checked!), so the daily cron
 * can't double-send. No admin BCC (owner's call) — admin visibility
 * is the "Reminded ×N" trail on the dashboard's Outstanding sections.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, isEmailConfigured } from "@/lib/email-send";

const FIRST_REMINDER_DAYS = 5;
const REPEAT_REMINDER_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Slack so "3 days" measured by a daily cron doesn't slip to 4. */
const TOLERANCE_MS = 12 * 60 * 60 * 1000;
/** Safety valve: max reminder EMAILS per run (oldest-due first). A
 *  client whose invoices span several secondary recipients sends
 *  several emails, so this caps sends, not distinct clients. */
const MAX_EMAILS_PER_RUN = 25;
/** Stop nagging after this many reminders per invoice (owner's call:
 *  ~2.5 weeks of nudges, then it's back in human hands — the dashboard
 *  Outstanding lists still show it). */
const MAX_REMINDERS_PER_INVOICE = 5;
/** Gentle spacing between Resend calls (default rate limit ~2/s). */
const SEND_GAP_MS = 650;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

type ClientRow = {
  name: string | null;
  email: string | null;
  payment_reminders: boolean | null;
};

function clientOf(row: any): ClientRow | null {
  const c = Array.isArray(row?.client) ? row.client[0] : row?.client;
  return (c as ClientRow) ?? null;
}

/** Is this invoice due for a reminder now? */
function dueForReminder(
  sentAt: string | null,
  lastReminderAt: string | null,
  now: number,
): boolean {
  if (!sentAt) return false;
  if (!lastReminderAt) {
    return (
      now - new Date(sentAt).getTime() >=
      FIRST_REMINDER_DAYS * DAY_MS - TOLERANCE_MS
    );
  }
  return (
    now - new Date(lastReminderAt).getTime() >=
    REPEAT_REMINDER_DAYS * DAY_MS - TOLERANCE_MS
  );
}

/** One open item (stage invoice or extension invoice) in a digest. */
type DueItem = {
  kind: "stage" | "extension";
  id: string; // stages.id or stage_extensions.id
  address: string;
  label: string; // "Invoice" | "Extension invoice"
  balance: number;
  pdfUrl: string;
  payLink: string | null;
  onlineTotal: number | null;
  /** Oldest relevant date, for ordering + cap fairness. */
  dueSince: number;
  ccEmail: string | null;
  reminderCount: number;
};

function digestEmail(opts: {
  greeting: string;
  items: DueItem[];
}): { subject: string; text: string; html: string } {
  const { greeting, items } = opts;
  const total = items.reduce((s, i) => s + i.balance, 0);
  const totalStr = `$${total.toFixed(2)}`;
  // Anchor multi-item subjects to an address and scope the intro to
  // "the invoices below": a client can now receive several emails in
  // one run (one per secondary recipient), so the copy must never
  // claim to be their account-wide total, and two same-day emails
  // must not share an identical subject (they'd thread in Gmail).
  const subject =
    items.length === 1
      ? `Payment reminder: ${items[0].label.toLowerCase()} for ${items[0].address} — Stone Home Staging`
      : `Payment reminder: ${items[0].address} + ${items.length - 1} more — Stone Home Staging`;

  const intro =
    items.length === 1
      ? `Just a friendly reminder that the ${items[0].label.toLowerCase()} for ${items[0].address} has an outstanding balance of $${items[0].balance.toFixed(2)}.`
      : `Just a friendly reminder that the ${items.length} invoices below have a combined balance of ${totalStr}.`;

  const textItems = items
    .map((i) => {
      const pay = i.payLink
        ? `\n  Pay online (3% card fee applies): ${i.payLink}`
        : "";
      return `- ${i.label} — ${i.address}: $${i.balance.toFixed(2)}\n  Invoice PDF: ${i.pdfUrl}${pay}`;
    })
    .join("\n");
  const text =
    `Hi ${greeting},\n\n${intro}\n\n${textItems}\n\n` +
    `Payment by check / cash / Zelle / Venmo — details on each invoice.` +
    `\n\nIf you've already sent payment, please disregard this — and thank you!\n\nStone Home Staging`;

  const htmlItems = items
    .map(
      (i) => `
      <div style="border:1px solid #e2e8f0; border-radius:10px; padding:14px 16px; margin:10px 0;">
        <div style="font-size:14px; color:#475569;">${escapeHtml(i.label)}</div>
        <div style="font-weight:600;">${escapeHtml(i.address)}</div>
        <div style="margin:6px 0 10px;">Balance due: <strong>$${escapeHtml(
          i.balance.toFixed(2),
        )}</strong></div>
        <a href="${i.pdfUrl}" style="display:inline-block; padding:9px 16px; background:#a9761e; border-radius:8px; color:#ffffff; font-weight:600; text-decoration:none; font-size:14px;">View invoice PDF</a>
        ${
          i.payLink && i.onlineTotal
            ? `&nbsp;&nbsp;<a href="${i.payLink}" style="display:inline-block; padding:9px 16px; background:#1b1b1b; border-radius:8px; color:#ffffff; font-weight:600; text-decoration:none; font-size:14px;">Pay $${escapeHtml(
                i.onlineTotal.toFixed(2),
              )} online</a>`
            : ""
        }
      </div>`,
    )
    .join("");

  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; color: #0f172a; max-width: 560px; margin: 0 auto;">
      <p>Hi ${escapeHtml(greeting)},</p>
      <p>${escapeHtml(intro)}</p>
      ${htmlItems}
      <p style="color:#475569; font-size: 14px;">
        Pay online with a card where offered (a 3% processing fee applies),
        or by check / cash / Zelle / Venmo — details on each invoice.
      </p>
      <p style="color:#475569; font-size: 14px;">
        If you&rsquo;ve already sent payment, please disregard this — and thank you!
      </p>
      <p style="color:#475569; font-size: 14px;">— Stone Home Staging</p>
    </div>
  `;
  return { subject, text, html };
}

export type PaymentReminderResult = {
  /** Reminder emails sent this run — one per (client, secondary) group,
   *  so this can exceed the number of distinct clients reached. */
  emailsSent: number;
  invoiceItems: number;
  extensionItems: number;
  skippedNoPdf: number;
  errors: number;
  aborted?: string;
};

export async function runPaymentReminderCheck(): Promise<PaymentReminderResult> {
  const result: PaymentReminderResult = {
    emailsSent: 0,
    invoiceItems: 0,
    extensionItems: 0,
    skippedNoPdf: 0,
    errors: 0,
  };
  if (!isEmailConfigured()) {
    result.aborted = "email not configured";
    return result;
  }
  const admin = createAdminClient();
  const now = Date.now();

  // ---- Collect due stage invoices -------------------------------------
  // The unpaid backlog is business-bounded (dozens), so no pagination.
  // NOTE: no pdf filter here — PDF-less rows are counted so the cron
  // result surfaces invoices that can never remind.
  const { data: stages, error: stagesErr } = await admin
    .from("stages")
    .select(
      "id, address, amount, status, escrow, invoice_sent_at, invoice_reminder_last_at, invoice_reminder_count, invoice_pdf_url, accept_online_payment, stripe_payment_link_url, secondary_recipient_email, client:clients(name, email, payment_reminders)",
    )
    .is("paid_at", null)
    .gt("amount", 0)
    .not("invoice_sent_at", "is", null)
    .neq("status", "cancelled")
    .neq("status", "estimate")
    .eq("escrow", false);
  if (stagesErr) {
    result.aborted = `stages query failed: ${stagesErr.message}`;
    return result;
  }

  const eligibleStages = (stages ?? []).filter((s: any) => {
    const c = clientOf(s);
    if (!c?.email || c.payment_reminders === false) return false;
    if (Number(s.invoice_reminder_count ?? 0) >= MAX_REMINDERS_PER_INVOICE) {
      return false;
    }
    return dueForReminder(s.invoice_sent_at, s.invoice_reminder_last_at, now);
  });
  result.skippedNoPdf = eligibleStages.filter(
    (s: any) => !s.invoice_pdf_url,
  ).length;
  const dueStages = eligibleStages.filter((s: any) => !!s.invoice_pdf_url);

  // Partial payments: balance = amount - ledger sum. FAIL CLOSED on
  // error — a missing ledger would overstate every balance and offer
  // full-amount pay links on partially-paid invoices.
  const paidByStage = new Map<string, number>();
  if (dueStages.length > 0) {
    const { data: pays, error: paysErr } = await admin
      .from("stage_payments")
      .select("stage_id, amount")
      .in(
        "stage_id",
        dueStages.map((s: any) => s.id),
      );
    if (paysErr) {
      result.aborted = `payments query failed: ${paysErr.message}`;
      return result;
    }
    for (const p of pays ?? []) {
      paidByStage.set(
        p.stage_id,
        (paidByStage.get(p.stage_id) ?? 0) + Number(p.amount ?? 0),
      );
    }
  }

  // ---- Collect due extension invoices ----------------------------------
  const { data: exts, error: extsErr } = await admin
    .from("stage_extensions")
    .select(
      "id, stage_id, amount, pdf_url, pdf_sent_at, reminder_last_at, reminder_count, stage:stages(address, status, escrow, secondary_recipient_email, client:clients(name, email, payment_reminders))",
    )
    .is("paid_at", null)
    .gt("amount", 0)
    .not("pdf_sent_at", "is", null)
    .not("pdf_url", "is", null);
  if (extsErr) {
    result.aborted = `extensions query failed: ${extsErr.message}`;
    return result;
  }

  // ---- Group everything due into digests -------------------------------
  // Key = client email + secondary CC. Items with no secondary share the
  // client-only digest; each distinct secondary gets its own email so a
  // CC'd party only ever sees the transaction they're on.
  type Group = {
    clientName: string | null;
    email: string;
    /** The one secondary CC shared by every item in this group, if any. */
    ccEmail: string | null;
    items: DueItem[];
  };
  const groups = new Map<string, Group>();
  function addItem(email: string, clientName: string | null, item: DueItem) {
    // clients.email is stored verbatim from the form and can carry stray
    // whitespace — normalize before comparing/keying, or a secondary
    // equal to the client's own address would split into its own digest.
    const addr = email.trim();
    const cc =
      item.ccEmail && item.ccEmail !== addr.toLowerCase() ? item.ccEmail : null;
    const key = `${addr.toLowerCase()}|${cc ?? ""}`;
    const g =
      groups.get(key) ?? { clientName, email: addr, ccEmail: cc, items: [] };
    g.items.push(item);
    groups.set(key, g);
  }

  for (const s of dueStages as any[]) {
    const c = clientOf(s)!;
    const balance = Number(s.amount ?? 0) - (paidByStage.get(s.id) ?? 0);
    if (balance <= 0) continue; // fully covered; trigger just hasn't stamped
    // The Stripe link charges the FULL amount — only offer it when
    // nothing has been paid yet, so the button never overcharges.
    const canPayOnline =
      !!s.accept_online_payment &&
      !!s.stripe_payment_link_url &&
      (paidByStage.get(s.id) ?? 0) === 0;
    addItem(c.email!, c.name, {
      kind: "stage",
      id: s.id,
      address: s.address,
      label: "Invoice",
      balance,
      pdfUrl: s.invoice_pdf_url,
      payLink: canPayOnline ? s.stripe_payment_link_url : null,
      onlineTotal: canPayOnline ? Math.round(balance * 1.03 * 100) / 100 : null,
      dueSince: new Date(
        s.invoice_reminder_last_at ?? s.invoice_sent_at,
      ).getTime(),
      ccEmail:
        typeof s.secondary_recipient_email === "string" &&
        s.secondary_recipient_email.trim()
          ? s.secondary_recipient_email.trim().toLowerCase()
          : null,
      reminderCount: Number(s.invoice_reminder_count ?? 0),
    });
  }

  for (const x of (exts ?? []) as any[]) {
    const stage = Array.isArray(x.stage) ? x.stage[0] : x.stage;
    if (
      !stage ||
      stage.status === "cancelled" ||
      stage.status === "estimate" ||
      stage.escrow
    ) {
      continue;
    }
    const c = clientOf(stage);
    if (!c?.email || c.payment_reminders === false) continue;
    if (Number(x.reminder_count ?? 0) >= MAX_REMINDERS_PER_INVOICE) continue;
    if (!dueForReminder(x.pdf_sent_at, x.reminder_last_at, now)) continue;
    addItem(c.email, c.name, {
      kind: "extension",
      id: x.id,
      address: stage.address,
      label: "Extension invoice",
      balance: Number(x.amount ?? 0),
      pdfUrl: x.pdf_url,
      payLink: null,
      onlineTotal: null,
      dueSince: new Date(x.reminder_last_at ?? x.pdf_sent_at).getTime(),
      // Inherit the stage's secondary recipient so a stage invoice and
      // its extension (same transaction, same parties) share one email
      // instead of splitting into a CC'd email and a client-only one.
      ccEmail:
        typeof stage.secondary_recipient_email === "string" &&
        stage.secondary_recipient_email.trim()
          ? stage.secondary_recipient_email.trim().toLowerCase()
          : null,
      reminderCount: Number(x.reminder_count ?? 0),
    });
  }

  // Oldest-due clients first; cap per run as a safety valve.
  const ordered = Array.from(groups.values()).sort(
    (a, b) =>
      Math.min(...a.items.map((i) => i.dueSince)) -
      Math.min(...b.items.map((i) => i.dueSince)),
  );
  const toSend = ordered.slice(0, MAX_EMAILS_PER_RUN);

  const nowIso = () => new Date().toISOString();
  for (const g of toSend) {
    const greeting = (g.clientName ?? "").split(/\s+/)[0] || "there";
    const { subject, text, html } = digestEmail({ greeting, items: g.items });
    const cc = g.ccEmail ? [g.ccEmail] : [];
    try {
      await sendEmail({
        to: g.email,
        ...(cc.length > 0 ? { cc } : {}),
        subject,
        text,
        html,
      });
    } catch (e) {
      result.errors += 1;
      console.error("[payment-reminders] send failed:", g.email, e);
      await sleep(SEND_GAP_MS);
      continue; // nothing stamped — this client retries next run
    }

    // Stamp every item in the digest. CHECK each update — a silent
    // stamp failure would re-send the same reminder every day.
    for (const i of g.items) {
      const { error: stampErr } =
        i.kind === "stage"
          ? await admin
              .from("stages")
              .update({
                invoice_reminder_last_at: nowIso(),
                invoice_reminder_count: i.reminderCount + 1,
              })
              .eq("id", i.id)
          : await admin
              .from("stage_extensions")
              .update({
                reminder_last_at: nowIso(),
                reminder_count: i.reminderCount + 1,
              })
              .eq("id", i.id);
      if (stampErr) {
        result.errors += 1;
        console.error(
          "[payment-reminders] STAMP FAILED (will re-send next run):",
          i.kind,
          i.id,
          stampErr.message,
        );
      } else if (i.kind === "stage") {
        result.invoiceItems += 1;
      } else {
        result.extensionItems += 1;
      }
    }
    result.emailsSent += 1;
    await sleep(SEND_GAP_MS);
  }

  if (ordered.length > toSend.length) {
    console.warn(
      `[payment-reminders] capped: ${ordered.length - toSend.length} reminder email(s) deferred to the next run`,
    );
  }
  return result;
}
