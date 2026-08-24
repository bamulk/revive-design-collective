# Syncing updates from the original app (Stone Home Staging)

Revive was **copied** from Stone Home Staging (`bamulk/staging`), not git-forked,
so the two repos share no history — there's no automatic `git merge`. Bringing
over new upstream work is a **selective cherry-pick + reconcile** process.

## Remote

```bash
git remote add upstream git@github.com:bamulk/staging.git   # one-time
git fetch upstream
```

## Last sync point

- **Original clone point:** upstream `74c6b97` (2026-07-01)
- **Last synced up to:** upstream `6bb5994` (2026-08-21)

Update the "last synced" line whenever you sync again — it's how you know the
starting point for next time. To see what's new since the last sync:

```bash
git fetch upstream
git log --reverse --oneline 6bb5994..upstream/main
```

## Procedure

1. Branch: `git switch -c sync-upstream`
2. Cherry-pick the new commits in order:
   `git cherry-pick -x <oldest>^..<newest>` (or a curated list).
3. Resolve conflicts **preserving Revive's divergences**:
   - Brand: keep "Revive Design Collective", never "Stone Home Staging".
   - Palette: sage `#7c8b76` (dark `#9dae95`), never gold `#a9761e`/`#d9b679`.
   - No Zoho, no Stripe, no online-payment (`accept_online_payment`,
     `stripe_payment_link_url`, pay-online links/copy) — strip these if a
     ported commit reintroduces them.
   - Keep `EMAIL_REPLY_TO` (Revive's reply-to mechanism).
4. Skip commits that don't apply: the "Reply-To shop inbox" commit
   (superseded by `EMAIL_REPLY_TO`) and no-op "redeploy" chores.
5. After picking, sweep:
   ```bash
   grep -rniE "stone home|stonehomestaging|montserrat" src public
   grep -rniE "zoho|stripe|accept_online_payment" src
   grep -rniE "#a9761e|#d9b679|#d4a24a" src
   ```
   Fix anything that turns up.
6. If `package.json` changed, run `npm install`.
7. **Migrations:** new `supabase/migrations/*.sql` files must be run on Revive's
   Supabase (SQL editor), and added to `supabase/setup-full.sql`. Watch for
   number collisions with Revive-only migrations and renumber the Revive ones
   to the end.
8. Verify: `npx tsc --noEmit` and `npm run build`.
9. Merge to `main`, push, run the new migrations on Supabase, redeploy.
