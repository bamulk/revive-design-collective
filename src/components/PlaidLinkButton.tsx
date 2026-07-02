"use client";

import dynamic from "next/dynamic";
import { Link2 } from "lucide-react";

/**
 * Lazy wrapper around the real PlaidLinkButton. The react-plaid-link
 * SDK pulls ~50 KB gzipped on top of the Plaid Link iframe loader.
 * The actual "Connect a bank" tap is rare (admins do it once or twice
 * a year), so we defer the library until the finance page mounts the
 * button rather than shipping it in every page bundle.
 *
 * Disabled placeholder mirrors the live button's shape so the layout
 * doesn't jump when it swaps in.
 */
const PlaidLinkButton = dynamic(() => import("./PlaidLinkButton.impl"), {
  ssr: false,
  loading: () => (
    <button
      type="button"
      disabled
      className="inline-flex items-center gap-1.5 bg-slate-900 text-white rounded-lg px-4 py-2.5 text-sm opacity-60 cursor-progress"
    >
      <Link2 size={14} /> Connect a bank
    </button>
  ),
});

export default PlaidLinkButton;
