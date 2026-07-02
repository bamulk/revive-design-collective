import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const sb = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x.toISOString().slice(0, 10);
}
const today = new Date();

const clients = [
  {
    name: "Alice Morgan",
    email: "alice.morgan@example.com",
    phone: "555-210-4402",
    address: "742 Maple Ave, Portland OR",
    notes: "Referred by realtor Kim. Prefers modern minimalist style.",
  },
  {
    name: "Brookline Realty Group",
    email: "contact@brooklinerealty.example.com",
    phone: "555-882-7711",
    address: "120 Commerce St, Suite 300, Boston MA",
    notes: "Repeat client — 4-6 listings per quarter. Invoice monthly.",
  },
];

const { data: clientRows, error: cErr } = await sb
  .from("clients")
  .insert(clients)
  .select("id, name");
if (cErr) throw cErr;
console.log("✓ Inserted clients:");
clientRows.forEach((c) => console.log(`  - ${c.name}`));

const [aliceId, brooklineId] = clientRows.map((c) => c.id);

const stages = [
  {
    client_id: aliceId,
    address: "742 Maple Ave, Portland OR 97212",
    amount: 3200,
    status: "scheduled",
    stage_date: addDays(today, 7),
    destage_date: addDays(today, 45),
    notes: "3BR/2BA, ~2,100 sqft. Focus: living room, primary bedroom, dining.",
  },
  {
    client_id: brooklineId,
    address: "45 Hawthorne Rd, Brookline MA 02446",
    amount: 4850,
    status: "staged",
    stage_date: addDays(today, -4),
    destage_date: addDays(today, 26),
    notes: "Full staging: 4 bedrooms, 2 living areas, formal dining.",
  },
];

const { data: stageRows, error: sErr } = await sb
  .from("stages")
  .insert(stages)
  .select("id, address");
if (sErr) throw sErr;

console.log("✓ Inserted stages:");
stageRows.forEach((s) => console.log(`  - ${s.address}`));
console.log("\nDone.");
