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
  intro:
    "The following rooms will be staged: Living Room, Dining Room, Kitchen, Primary Bedroom, and Bathrooms. In addition to what is outlined above, rooms will include artwork, mirrors, centerpieces, plants, throw pillows, and room accessories.",
  terms: [
    {
      title: "Staging Fee & Term",
      body: "The staging fee is a flat fee, determined at the time of the agreement. It includes two months of staging, commencing on the date of install. The total fee is due upon installation of furnishings. Additional 30-day extensions are available for 50% of the original staging fee ({{extension_amount}}).",
    },
    {
      title: "Payment",
      body: "Payment is due upon completion of staging \u2014 on the day the staging is installed, not on any later invoice date. Please make checks payable to: Revive Design Collective. Zelle: 530-251-3898 (Williams Real Estate Services).",
    },
    {
      title: "De-Staging",
      body: "Furnishings will be left in place until contingencies are removed, the realtor/client approves removal, or the agreement has expired. A 72-hour notice is required for de-staging the home.",
    },
    {
      title: "Furnishing Selection",
      body: "Client agrees the selection of furnishings is at the sole discretion of the stager.",
    },
    {
      title: "Ownership of Furnishings",
      body: "Client agrees that the furnishings are owned and leased by Revive Design Collective for display purposes only. While on the property, furnishings are to remain staged and are not to be used in any other fashion.",
    },
    {
      title: "Care of Furnishings",
      body: "Client agrees to exercise all due care in keeping, caring for, and preserving the furnishings. Cleaning fee starts at $600.",
    },
    {
      title: "Loss or Damage",
      body: "Client shall remain responsible for all loss or damages to the furnishings while they are on the property; up to and including actual replacement value for each missing or damaged item.",
    },
    {
      title: "Publicity",
      body: "Client agrees that photographs from the listing may be used for publicity on Revive Design Collective social media sites, website, and other marketing materials.",
    },
    {
      title: "No Pets",
      body: "NO PETS. Occupied staging \u2014 a cleaning fee will be charged if the furniture is returned with pet hair, dirt, or any stains. Please cover all staging furniture with linens.",
    },
    {
      title: "Cancellation",
      body: "Cancellation fee \u2014 please note that we book 2-3 weeks in advance and your stage is part of a chain of events; if you decide to cancel, there will be a $1,000 fee.",
    },
    {
      title: "Home Readiness",
      body: "Home must be clean prior to staging.",
    },
    {
      title: "Property Access",
      body: "Only Revive Design Co is allowed on the property during staging and de-staging. The presence of contractors slows down the process and workflow of our team.",
    },
    {
      title: "Lockbox & Hours",
      body: "We work hard to provide staging for a number of clients in the same timeframe. Due to real estate timelines, a contractor lockbox is required to be on site for the move in and the move out. We are unable to meet realtors at the property at a specific time. Please note that we start as early as 7am and do not work past 1pm.",
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
