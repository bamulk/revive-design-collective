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
        title="Import Bank of America activity"
        subtitle="Paste your Activity export — either download format works — and we'll parse, dedupe, and save the outflows"
      />
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900 space-y-2">
        <p className="font-medium">How to get the data from BoA</p>
        <ol className="list-decimal list-inside space-y-1 text-blue-900/90">
          <li>Sign in to bankofamerica.com</li>
          <li>
            Open your account → <em>Activity</em> tab
          </li>
          <li>
            Click <em>Download</em> and pick either format —{" "}
            <em>Comma Delimited (CSV)</em> and <em>Tab Delimited</em> both
            import fine
          </li>
          <li>
            Open the downloaded file in any app — TextEdit, Notepad, even
            Excel or Numbers — select everything, and copy. (Or skip the
            download entirely: select the transaction rows right on the
            Activity page and copy them.)
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
