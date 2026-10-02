begin;

create function public.list_pending_follow_requests(
  p_actor_id uuid
)
returns table (
  request_id uuid,
  requester_id uuid,
  requester_username text,
  requester_display_name text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    follow_request.id as request_id,
    requester.id as requester_id,
    requester.username as requester_username,
    requester.display_name as requester_display_name,
    follow_request.created_at
  from public.follow_requests as follow_request
  join public.profiles as requester
    on requester.id = follow_request.requester_id
  where follow_request.target_id = p_actor_id
    and follow_request.status = 'pending'
  order by
    follow_request.created_at desc,
    follow_request.id desc;
$$;

revoke execute
  on function public.list_pending_follow_requests(uuid)
  from public, anon, authenticated;

grant execute
  on function public.list_pending_follow_requests(uuid)
  to service_role;

commit;
