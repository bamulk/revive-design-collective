/**
 * Who a stage's money-facing email goes to. When the agent handed the
 * stage to their seller (homeowner_name + homeowner_email set), the
 * seller signs AND pays — every invoice, reminder, extension, and fee
 * email must address them, never the agent. Otherwise the stage's
 * client (the agent) is the recipient.
 *
 * Accepts the row shapes the app already uses: `client` or `clients`
 * as an object or a one-element array.
 */
export type StageRecipient = {
  name: string | null;
  email: string | null;
  /** True when the seller override is in effect. */
  isHomeowner: boolean;
};

type ClientLike = { name?: string | null; email?: string | null } | null | undefined;

export function stageRecipient(stage: {
  homeowner_name?: string | null;
  homeowner_email?: string | null;
  client?: ClientLike | ClientLike[];
  clients?: ClientLike | ClientLike[];
}): StageRecipient {
  const hn = typeof stage.homeowner_name === "string" ? stage.homeowner_name.trim() : "";
  const he = typeof stage.homeowner_email === "string" ? stage.homeowner_email.trim() : "";
  if (hn && he) return { name: hn, email: he, isHomeowner: true };
  const raw = stage.client ?? stage.clients;
  const c = (Array.isArray(raw) ? raw[0] : raw) as ClientLike;
  const email = typeof c?.email === "string" ? c.email.trim() : "";
  return { name: c?.name ?? null, email: email || null, isHomeowner: false };
}
