"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ContractTerm } from "@/lib/contract-template";

async function assertAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") throw new Error("Admin only");
  return supabase;
}

export type UpdateContractTemplateResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateContractTemplateAction(input: {
  company_name: string;
  intro: string | null;
  terms: ContractTerm[];
}): Promise<UpdateContractTemplateResult> {
  try {
    const supabase = await assertAdmin();

    const companyName = input.company_name.trim();
    if (!companyName) throw new Error("Company name is required");

    // Normalize and drop any rows with both title + body empty.
    const terms = (input.terms || [])
      .map((t) => ({
        title: String(t.title || "").trim(),
        body: String(t.body || "").trim(),
      }))
      .filter((t) => t.title || t.body);

    const { error } = await supabase
      .from("contract_template")
      .update({
        company_name: companyName,
        intro: input.intro?.trim() || null,
        terms,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    if (error) throw new Error(error.message);

    revalidatePath("/admin/contract");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Save failed" };
  }
}
