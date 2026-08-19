import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        // Passkey (WebAuthn) sign-in — Supabase marks this experimental
        // and requires the explicit opt-in. Used by the login page's
        // passkey button and the account Passkeys manager.
        experimental: { passkey: true },
      },
    },
  );
}
