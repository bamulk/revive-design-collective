"use client";

import { useState } from "react";

/**
 * Optional second signer / payer on a new stage or estimate. Toggling
 * the checkbox reveals two extra inputs (name + email) that get
 * submitted with the rest of the form. The server action looks for
 * `secondary_recipient_name` + `secondary_recipient_email`; both blank
 * means "no secondary."
 *
 * When set, the secondary person is added as a co-signer on the
 * contract envelope (both must sign) and CC'd on every estimate /
 * invoice email.
 */
export default function SecondaryRecipientFields({
  defaultEnabled = false,
  defaultName = "",
  defaultEmail = "",
}: {
  defaultEnabled?: boolean;
  defaultName?: string;
  defaultEmail?: string;
}) {
  const [enabled, setEnabled] = useState(defaultEnabled);
  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-brand"
        />
        <span>
          Add a second signer / payer
          <span className="block text-xs text-slate-500 dark:text-slate-400">
            For when the client splits the bill with the homeowner. Both
            people sign the contract and are CC&apos;d on every estimate +
            invoice email.
          </span>
        </span>
      </label>
      {enabled && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-6">
          <input
            name="secondary_recipient_name"
            required
            defaultValue={defaultName}
            placeholder="Homeowner full name"
            className="border rounded px-3 py-2.5 text-base"
          />
          <input
            type="email"
            name="secondary_recipient_email"
            required
            defaultValue={defaultEmail}
            placeholder="homeowner@example.com"
            className="border rounded px-3 py-2.5 text-base"
          />
        </div>
      )}
    </div>
  );
}
