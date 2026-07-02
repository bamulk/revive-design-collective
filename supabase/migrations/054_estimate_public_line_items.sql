-- The public estimate page reads escrow / travel_fee / line_items, but the
-- estimate_public view never exposed them — so custom line items didn't show
-- and the displayed total was inflated by escrow + travel. Append the three
-- columns (CREATE OR REPLACE requires existing columns stay first, in order).
-- (Applied to the live DB via MCP as 054.)
create or replace view public.estimate_public as
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

-- Preserve the security_invoker setting from migration 016.
alter view public.estimate_public set (security_invoker = on);
