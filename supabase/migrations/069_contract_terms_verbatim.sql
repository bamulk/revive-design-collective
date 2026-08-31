-- Replace the agreement's Terms with Revive's authoritative wording: the
-- three money clauses (fee/extensions, payment, de-staging) followed by
-- the 10 numbered addendums exactly as they appear in the signed
-- contract. Supersedes the lightly-reworded set from migration 064.
update public.contract_template
set terms = jsonb_build_array(
    jsonb_build_object('title', 'Staging Fee & Term', 'body', 'The staging fee is a flat fee, determined at the time of the agreement. It includes two months of staging, commencing on the date of install. The total fee is due upon installation of furnishings. Additional 30-day extensions are available for 50% of the original staging fee ({{extension_amount}}).'),
    jsonb_build_object('title', 'Payment', 'body', 'Payment is due upon completion of staging — on the day the staging is installed, not on any later invoice date. Please make checks payable to: Revive Design Collective. Zelle: 530-251-3898 (Williams Real Estate Services).'),
    jsonb_build_object('title', 'De-Staging', 'body', 'Furnishings will be left in place until contingencies are removed, the realtor/client approves removal, or the agreement has expired. A 72-hour notice is required for de-staging the home.'),
    jsonb_build_object('title', 'Furnishing Selection', 'body', 'Client agrees the selection of furnishings is at the sole discretion of the stager.'),
    jsonb_build_object('title', 'Ownership of Furnishings', 'body', 'Client agrees that the furnishings are owned and leased by Revive Design Collective for display purposes only. While on the property, furnishings are to remain staged and are not to be used in any other fashion.'),
    jsonb_build_object('title', 'Care of Furnishings', 'body', 'Client agrees to exercise all due care in keeping, caring for, and preserving the furnishings. Cleaning fee starts at $600.'),
    jsonb_build_object('title', 'Loss or Damage', 'body', 'Client shall remain responsible for all loss or damages to the furnishings while they are on the property; up to and including actual replacement value for each missing or damaged item.'),
    jsonb_build_object('title', 'Publicity', 'body', 'Client agrees that photographs from the listing may be used for publicity on Revive Design Collective social media sites, website, and other marketing materials.'),
    jsonb_build_object('title', 'No Pets', 'body', 'NO PETS. Occupied staging — a cleaning fee will be charged if the furniture is returned with pet hair, dirt, or any stains. Please cover all staging furniture with linens.'),
    jsonb_build_object('title', 'Cancellation', 'body', 'Cancellation fee — please note that we book 2-3 weeks in advance and your stage is part of a chain of events; if you decide to cancel, there will be a $1,000 fee.'),
    jsonb_build_object('title', 'Home Readiness', 'body', 'Home must be clean prior to staging.'),
    jsonb_build_object('title', 'Property Access', 'body', 'Only Revive Design Co is allowed on the property during staging and de-staging. The presence of contractors slows down the process and workflow of our team.'),
    jsonb_build_object('title', 'Lockbox & Hours', 'body', 'We work hard to provide staging for a number of clients in the same timeframe. Due to real estate timelines, a contractor lockbox is required to be on site for the move in and the move out. We are unable to meet realtors at the property at a specific time. Please note that we start as early as 7am and do not work past 1pm.')
  ),
  updated_at = now()
where id = 1;
