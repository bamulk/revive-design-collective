import { INVOICE_STATUS_LABEL, type InvoiceStatus } from "@/lib/custom-invoice";

const STYLES: Record<InvoiceStatus, string> = {
  draft: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 ring-slate-200",
  sent: "bg-blue-50 text-blue-700 ring-blue-200",
  paid: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  void: "bg-rose-50 text-rose-700 ring-rose-200",
};

export default function InvoiceStatusBadge({ status }: { status: string }) {
  const s = (status in STYLES ? status : "draft") as InvoiceStatus;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${STYLES[s]}`}
    >
      {INVOICE_STATUS_LABEL[s]}
    </span>
  );
}
