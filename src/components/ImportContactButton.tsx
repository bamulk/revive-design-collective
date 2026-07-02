"use client";

import { useRef, useState } from "react";
import { Contact, AlertCircle } from "lucide-react";

/**
 * "Import from contact card" — fills name / email / phone from an
 * iPhone-exported vCard (.vcf) file.
 *
 * Why a file picker instead of a one-tap contact picker:
 *   Safari (iOS) doesn't expose the W3C Contact Picker API. Chrome
 *   on Android does (`navigator.contacts.select`), so we feature-
 *   detect it and use that fast path when available. Everywhere else
 *   the user shares a contact from iOS Contacts → Save to Files,
 *   then picks that .vcf here.
 *
 * The parser is intentionally minimal — we only extract FN, the
 * first EMAIL, and the first TEL. Good enough for the inline
 * client-create form.
 */
export default function ImportContactButton({
  onImport,
}: {
  onImport: (data: {
    name: string;
    email: string;
    phone: string;
  }) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function nativePick(): Promise<boolean> {
    const c: any = (navigator as any).contacts;
    if (!c?.select) return false;
    try {
      setPending(true);
      const props = ["name", "email", "tel"];
      const result = await c.select(props, { multiple: false });
      const picked = result?.[0];
      if (!picked) return true;
      const name = (picked.name?.[0] ?? "").toString().trim();
      const email = (picked.email?.[0] ?? "").toString().trim();
      const phone = (picked.tel?.[0] ?? "").toString().trim();
      if (!name && !email && !phone) {
        setErr("Couldn't read the contact's fields.");
        return true;
      }
      onImport({ name, email, phone });
      return true;
    } catch (e: any) {
      setErr(e?.message || "Contact picker failed.");
      return true;
    } finally {
      setPending(false);
    }
  }

  async function onClick() {
    setErr(null);
    // Try the native picker first; if it's not available, fall back
    // to the file input.
    if (await nativePick()) return;
    fileRef.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setErr(null);
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking same file
    if (!file) return;
    try {
      setPending(true);
      const text = await file.text();
      const parsed = parseVcf(text);
      if (!parsed.name && !parsed.email && !parsed.phone) {
        setErr("That file didn't contain a name, email, or phone.");
        return;
      }
      onImport(parsed);
    } catch {
      setErr("Couldn't read that file. Make sure it's a .vcf contact card.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex items-center gap-1.5 text-sm text-brand hover:text-brand-hover disabled:opacity-60"
      >
        <Contact size={14} />
        {pending ? "Reading…" : "Import from contact card"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".vcf,text/vcard,text/x-vcard"
        onChange={onFile}
        className="hidden"
      />
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        On iPhone: open Contacts → tap a contact → Share Contact → Save
        to Files. Then pick that .vcf here.
      </p>
      {err && (
        <p className="text-xs text-rose-700 flex items-center gap-1">
          <AlertCircle size={12} />
          {err}
        </p>
      )}
    </div>
  );
}

/**
 * Minimal vCard 3.0 / 4.0 parser. Handles line folding (continuation
 * lines start with space/tab) and quoted-printable / base64 isn't
 * needed for the iOS Contacts export, which sends plain UTF-8.
 */
function parseVcf(text: string): { name: string; email: string; phone: string } {
  // Unfold folded lines: a line starting with space/tab is a
  // continuation of the previous line per RFC 6350.
  const unfolded = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const lines = unfolded.split(/\r\n|\n|\r/);

  let name = "";
  let email = "";
  let phone = "";
  let nField: { last: string; first: string } | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Each prop looks like "PROP;PARAM=VAL:value" or "PROP:value".
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const leftRaw = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const propName = leftRaw.split(";")[0].toUpperCase();

    switch (propName) {
      case "FN":
        if (!name) name = value.trim();
        break;
      case "N": {
        // N:Last;First;Middle;Prefix;Suffix
        const parts = value.split(";");
        nField = { last: (parts[0] ?? "").trim(), first: (parts[1] ?? "").trim() };
        break;
      }
      case "EMAIL":
        if (!email) email = value.trim();
        break;
      case "TEL":
        if (!phone) phone = value.trim();
        break;
    }
  }

  // Fall back to N when FN is missing.
  if (!name && nField) {
    name = [nField.first, nField.last].filter(Boolean).join(" ").trim();
  }
  return { name, email, phone };
}
