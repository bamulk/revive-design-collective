"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { extendStage, recordDestageChoice } from "@/lib/extension-core";

export type ExtensionResult =
  | { ok: true; newDestageDate?: string; amount?: number }
  | { ok: false; error: string };

export async function confirmExtensionAction(
  token: string,
): Promise<ExtensionResult> {
  // Capture a basic audit trail for the acceptance record.
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    null;
  const userAgent = h.get("user-agent") || null;
  const r = await extendStage(token, { ip, userAgent });
  revalidatePath(`/x/${token}`);
  return r;
}

export async function confirmDestageAction(
  token: string,
): Promise<ExtensionResult> {
  const r = await recordDestageChoice(token);
  revalidatePath(`/x/${token}`);
  return r;
}
