-- Single-statement consistent snapshot. Save result locally with restricted permissions.
select jsonb_build_object('capturedAt', statement_timestamp(), 'streamers',
  coalesce(jsonb_agg(jsonb_build_object('slug',s.slug,'streamer_id',s.id,
    'snapshot_id',a.id,'created_at',a.created_at,'wardrobe',a.payload->'wardrobe') order by s.slug),'[]'::jsonb)) as snapshot
from public.upbo_alpha_streamers s
left join lateral (
  select id,created_at,payload from public.upbo_alpha_audit_logs
  where streamer_id=s.id and action='wardrobe_updated'
  order by created_at desc,id desc limit 1
) a on true;
