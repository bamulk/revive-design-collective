-- The public estimate page reads escrow / travel_fee / line_items, but the
-- estimate_public view never exposed them — so custom line items didn't show
-- and the displayed total was inflated by escrow + travel. Add the three
-- columns. Drop-then-create (not CREATE OR REPLACE) so this is re-runnable
-- regardless of the view's current column set; re-grants afterward since a
-- drop clears grants.
drop view if exists public.estimate_public;
create view public.estimate_public as
  select
    s.id,
    s.address,
    s.amount,
    s.stage_date,
    s.destage_date,
    s.package_key,
    s.add_ons,
    s.discount,
    s.status,
    s.estimate_token,
    s.estimate_accepted_at,
    s.estimate_declined_at,
    c.name as client_name,
    s.escrow,
    s.travel_fee,
    s.line_items
  from stages s
  left join clients c on c.id = s.client_id;

-- Re-grant (the drop above cleared it) + preserve the security_invoker
-- setting from migration 016.
grant select on public.estimate_public to anon, authenticated;
alter view public.estimate_public set (security_invoker = on);
