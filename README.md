# Revive Design Collective

Home staging company management app — clients, stages, estimates, employees, photos, invoicing, finance, and a client portal.

Stack: Next.js 16 (App Router) · TypeScript · Tailwind · Supabase (Postgres + Auth + Storage) · Resend · SignatureAPI · Plaid · web push.

> Cloned from the Stone Home Staging app (`bamulk/staging`) and rebranded. The Zoho Invoice and Stripe integrations were removed — invoicing is built in (PDF generation + email), and payments are recorded manually (check / cash / zelle / venmo / card / other).

## 1. Supabase setup

This app needs its **own** Supabase project (do not reuse the original's).

1. Create a Supabase project at https://supabase.com.
2. In **SQL editor**, run `supabase/schema.sql` first — it creates the base tables, RLS, the `stage-photos` storage bucket, and a trigger that auto-creates a `profiles` row on signup.
3. Then run every file in `supabase/migrations/` **in numeric order** (001 → 035). They build the rest of the schema: tasks, signatures, pricing, estimates, expenses, push subscriptions, Plaid, payments, and more.
4. From **Project Settings → API**, copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` secret key → `SUPABASE_SERVICE_ROLE_KEY` (server-only; needed for inviting/removing employees)

### Make yourself an admin

After signing up the first time:

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

## 2. Environment

```bash
cp .env.local.example .env.local   # then fill it in
```

See the comments in `.env.local.example` for where each key comes from. Everything except Supabase is optional-ish — features degrade gracefully (no Resend key → no emails, no Plaid keys → no bank feed, etc.).

## 3. Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## 4. Deploy (Vercel)

This project deploys to its **own Vercel account/team** (separate from the original app's).

1. Push this repo to GitHub and import it in the Vercel dashboard on the target account.
2. Add all `.env.local` values as Environment Variables in the Vercel project.
3. `vercel.json` defines the daily cron jobs (`reminders`, `extension-reminders`, `check-listing-status`, `plaid-sync`). Set `CRON_SECRET` so the endpoints reject outside calls.
4. Point the production domain (e.g. `app.revivedesigncollective.com`) at the project and update `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_SITE_URL` to match.

## App structure

- `/login` — sign in/up; `/portal` — client-facing portal
- `/` — dashboard with stats and upcoming stages
- `/clients` — list/create; `/clients/[id]` — edit + their stages
- `/stages` — list (+ board / calendar / map / groups views); `/stages/new` — create; `/stages/[id]` — edit, photos, contract, invoice
- `/estimates` — create and share estimates clients can accept online
- `/finance` — expenses, Plaid bank feed, P&L export
- `/employees` — admin only: invite, role change, remove

## Notes

- The `stage-photos` storage bucket is private. Photos are served via signed URLs (1h).
- Auth gate lives in `src/proxy.ts` (Next 16 renamed `middleware` → `proxy`).
- All mutations go through Server Actions in `actions.ts` files next to each route.
- The app icons in `public/` (`icon.png`, `icon-maskable.png`, `apple-icon.png`) are generated placeholders — swap in real brand assets when available.
