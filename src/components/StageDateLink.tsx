"use client";

import { useEffect, useRef } from "react";

/**
 * Live-link the destage_date input to stage_date + 60 days while the
 * user types. We only auto-fill when destage is empty OR when its
 * current value still matches the previous auto-fill — once the user
 * types their own date, we stop touching it.
 *
 * Pure DOM glue: zero state, no React renders. Drops in next to the
 * existing <input name="stage_date"> + <input name="destage_date">
 * inputs on the stage edit form.
 */
export default function StageDateLink({
  stageInputName = "stage_date",
  destageInputName = "destage_date",
  daysOffset = 60,
}: {
  stageInputName?: string;
  destageInputName?: string;
  daysOffset?: number;
}) {
  const lastAutoRef = useRef<string | null>(null);

  useEffect(() => {
    const stage = document.querySelector<HTMLInputElement>(
      `input[name="${stageInputName}"]`
    );
    const destage = document.querySelector<HTMLInputElement>(
      `input[name="${destageInputName}"]`
    );
    if (!stage || !destage) return;

    function addDays(iso: string, days: number): string | null {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
      const [y, m, d] = iso.split("-").map(Number);
      const t = Date.UTC(y, m - 1, d) + days * 86400000;
      const dt = new Date(t);
      return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(
        2,
        "0"
      )}-${String(dt.getUTCDate()).padStart(2, "0")}`;
    }

    function onStageChange() {
      const computed = addDays(stage!.value, daysOffset);
      if (!computed) return;
      const current = destage!.value;
      // Fill if destage is empty, or if it still matches the last auto
      // value (meaning the user hasn't manually overridden it yet).
      if (!current || current === lastAutoRef.current) {
        destage!.value = computed;
        lastAutoRef.current = computed;
      }
    }

    function onDestageInput() {
      // Once the user types their own date, stop auto-syncing until they
      // clear it again. We track this by clearing lastAutoRef whenever
      // destage no longer matches the last auto value.
      if (destage!.value !== lastAutoRef.current) {
        lastAutoRef.current = null;
      }
    }

    stage.addEventListener("change", onStageChange);
    destage.addEventListener("input", onDestageInput);
    return () => {
      stage.removeEventListener("change", onStageChange);
      destage.removeEventListener("input", onDestageInput);
    };
  }, [stageInputName, destageInputName, daysOffset]);

  return null;
}
