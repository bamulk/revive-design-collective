import { createClient } from "@/lib/supabase/server";

export type ContractTerm = { title: string; body: string };

export type ContractTemplate = {
  company_name: string;
  intro: string | null;
  terms: ContractTerm[];
};

/**
 * Built-in defaults used when the DB has no template row yet (e.g.
 * migration not applied or a brand-new project).
 */
export const DEFAULT_TEMPLATE: ContractTemplate = {
  company_name: "Revive Design Collective",
  intro: null,
  terms: [
    {
      title: "Services",
      body: "Stager will provide home staging services at the Property, including furniture and decor selection, placement, and removal on the destage date.",
    },
    {
      title: "Fee",
      body: "Client agrees to pay the total fee shown above. An invoice will be issued on the stage date. Payment is due on the day of staging unless otherwise agreed in writing.",
    },
    {
      title: "Access",
      body: "Client will provide Stager reasonable access to the Property on the stage and destage dates. Fees for a missing lockbox key, an inaccessible home, or a home not ready for staging are set out in the Additional Fees section, which Client initials to acknowledge.",
    },
    {
      title: "Care of Property",
      body: "Stager will exercise reasonable care. Stager is not responsible for pre-existing conditions or damage caused by third parties.",
    },
    {
      title: "Inventory",
      body: "All furniture and decor brought to the Property remain the property of Stager and will be removed on the destage date. Client agrees not to move, sell, or otherwise disturb the inventory.",
    },
    {
      title: "Cancellation",
      body: "Cancellations requested less than 72 hours before the stage date may incur a charge of up to 50% of the total fee.",
    },
    {
      title: "Entire Agreement",
      body: "This document is the full agreement between the parties regarding these services.",
    },
  ],
};

export async function getContractTemplate(): Promise<ContractTemplate> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("contract_template")
      .select("company_name, intro, terms")
      .eq("id", 1)
      .single();
    if (!data) return DEFAULT_TEMPLATE;
    const terms = Array.isArray(data.terms) ? (data.terms as ContractTerm[]) : [];
    return {
      company_name: data.company_name || DEFAULT_TEMPLATE.company_name,
      intro: data.intro,
      terms: terms.length ? terms : DEFAULT_TEMPLATE.terms,
    };
  } catch {
    return DEFAULT_TEMPLATE;
  }
}
