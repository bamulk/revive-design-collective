import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getContractTemplate } from "@/lib/contract-template";
import { PageHeader } from "@/components/ui";
import ContractTemplateEditor from "@/components/ContractTemplateEditor";
import { requireAdmin } from "@/lib/require-admin";

export const dynamic = "force-dynamic";

export default async function ContractTemplatePage() {
  await requireAdmin();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (me?.role !== "admin") redirect("/");

  const template = await getContractTemplate();

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="Contract template"
        subtitle="Text used in every signature request"
      />
      <ContractTemplateEditor initial={template} />
    </div>
  );
}
