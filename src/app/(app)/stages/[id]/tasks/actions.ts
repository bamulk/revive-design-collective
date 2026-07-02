"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function addTaskAction(stageId: string, formData: FormData) {
  const title = String(formData.get("title") || "").trim();
  if (!title) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // append to the end
  const { data: maxRow } = await supabase
    .from("stage_tasks")
    .select("position")
    .eq("stage_id", stageId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = (maxRow?.position ?? 0) + 1;

  const { error } = await supabase.from("stage_tasks").insert({
    stage_id: stageId,
    title,
    position,
    created_by: user?.id ?? null,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/stages/${stageId}`);
  revalidatePath(`/stages/board`);
}

export async function toggleTaskAction(
  stageId: string,
  taskId: string,
  isDone: boolean
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("stage_tasks")
    .update({
      is_done: isDone,
      completed_by: isDone ? user?.id ?? null : null,
      completed_at: isDone ? new Date().toISOString() : null,
    })
    .eq("id", taskId);
  if (error) throw new Error(error.message);
  revalidatePath(`/stages/${stageId}`);
  revalidatePath(`/stages/board`);
}

export async function deleteTaskAction(stageId: string, taskId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("stage_tasks").delete().eq("id", taskId);
  if (error) throw new Error(error.message);
  revalidatePath(`/stages/${stageId}`);
  revalidatePath(`/stages/board`);
}
