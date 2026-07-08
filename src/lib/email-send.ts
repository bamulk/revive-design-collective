// Thin wrapper around the Resend transactional email API.
// Docs: https://resend.com/docs
//
// Required env vars (Vercel → Project Settings → Environment Variables):
//   RESEND_API_KEY     - API key from https://resend.com/api-keys
//   EMAIL_FROM         - "Revive Design Collective <invoices@yourdomain.com>"
//                        The domain must be verified at
//                        https://resend.com/domains
//   EMAIL_REPLY_TO     - (optional) default Reply-To for all app email,
//                        e.g. a monitored inbox like lauren@revivedesigncollective.com.
//                        Falls back to EMAIL_FROM when unset; a per-send
//                        replyTo still overrides it.
//
// RESEND_API_KEY + EMAIL_FROM are required at send time; isEmailConfigured()
// tells the UI whether to enable the Send button.

import { Resend } from "resend";

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
}

export type EmailInput = {
  to: string;
  /** Optional CC, e.g. your own address for record-keeping. */
  cc?: string | string[];
  /** Optional BCC list — recipients won't see each other. */
  bcc?: string | string[];
  subject: string;
  /** Plain-text fallback (recommended for spam scoring). */
  text: string;
  /** HTML body — render with care since clients vary. */
  html: string;
  /** Optional Reply-To. Defaults to EMAIL_REPLY_TO, else EMAIL_FROM. */
  replyTo?: string;
};

export async function sendEmail(input: EmailInput): Promise<{ id: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    throw new Error(
      "Email isn't configured — set RESEND_API_KEY and EMAIL_FROM on the server."
    );
  }
  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    from,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    text: input.text,
    html: input.html,
    // Per-send replyTo wins; otherwise route replies to the configured
    // monitored inbox; otherwise Resend defaults Reply-To to `from`.
    replyTo: input.replyTo ?? process.env.EMAIL_REPLY_TO ?? undefined,
  });
  if (result.error) {
    throw new Error(`Resend ${result.error.name}: ${result.error.message}`);
  }
  if (!result.data?.id) {
    throw new Error("Resend returned no message id");
  }
  return { id: result.data.id };
}
