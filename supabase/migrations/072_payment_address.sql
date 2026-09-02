-- Add the remit-to address to the contract's Payment term. Targeted at
-- that one clause (matched by title) rather than rewriting the whole
-- terms array, so any edits made through the template editor survive.
update public.contract_template
set terms = (
  select jsonb_agg(
    case
      when t->>'title' = 'Payment' then jsonb_build_object(
        'title', 'Payment',
        'body', 'Payment is due upon completion of staging — on the day the staging is installed, not on any later invoice date. Please make checks payable to: Revive Design Collective, 220 Sandburg Drive, Sacramento, CA 95819. Zelle: 530-251-3898 (Williams Real Estate Services).'
      )
      else t
    end
    order by ord
  )
  from jsonb_array_elements(terms) with ordinality as e(t, ord)
)
where id = 1
  and terms @> '[{"title": "Payment"}]'::jsonb;
