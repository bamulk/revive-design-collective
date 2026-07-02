import Link from "next/link";
import { PageHeader } from "@/components/ui";
import BoaCsvImport from "@/components/BoaCsvImport";
import { requireAdmin } from "@/lib/require-admin";

export default async function BoaImportPage() {
  await requireAdmin();
  return (
    <div className="space-y-6 max-w-3xl">
      <Link href="/finance" className="text-sm text-slate-700 dark:text-slate-300 hover:underline">
        ← Finance
      </Link>
      <PageHeader
        title="Import Bank of America CSV"
        subtitle="Paste your downloaded Activity CSV — we'll parse, dedupe, and save the outflows"
      />
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900 space-y-2">
        <p className="font-medium">How to get the data from BoA</p>
        <ol className="list-decimal list-inside space-y-1 text-blue-900/90">
          <li>Sign in to bankofamerica.com</li>
          <li>
            Open your account → <em>Activity</em> tab. Either:
            <ul className="list-disc list-inside ml-5 mt-1">
              <li>
                Click <em>Download</em> → <em>Comma Delimited (CSV)</em>,
                open the file in TextEdit/Notepad, then paste; or
              </li>
              <li>
                Just select the transactions on screen and copy
                (Cmd/Ctrl + C) — pasted tab-separated rows work too
              </li>
            </ul>
          </li>
          <li>Paste below and hit Import</li>
        </ol>
        <p className="text-xs">
          Only outflows (negative amounts) are imported as expenses. Credits
          are ignored — income comes from paid stages automatically.
          Re-pasting the same rows is safe: duplicates are detected and
          skipped.
        </p>
      </div>

      <BoaCsvImport />
    </div>
  );
}
