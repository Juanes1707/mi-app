begin;

create function public.respond_follow_request(
  p_actor_id uuid,
  p_request_id uuid,
  p_decision text
)
returns table (
  result_status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_requester_id uuid;
  v_target_id uuid;
  v_request_status text;
begin
  if p_decision is null or p_decision not in ('accept', 'reject') then
    return query
      select 'invalid_decision'::text;
    return;
  end if;

  select
    follow_request.requester_id,
    follow_request.target_id,
    follow_request.status
  into
    v_requester_id,
    v_target_id,
    v_request_status
  from public.follow_requests as follow_request
  where follow_request.id = p_request_id
    and follow_request.target_id = p_actor_id
  for update;

  if not found then
    return query
      select 'request_not_found'::text;
    return;
  end if;

  if v_request_status <> 'pending' then
    return query
      select 'already_resolved'::text;
    return;
  end if;

  if p_decision = 'accept' then
    insert into public.follows (follower_id, followed_id)
    values (v_requester_id, v_target_id)
    on conflict (follower_id, followed_id) do nothing;

    update public.follow_requests as follow_request
    set
      status = 'accepted',
      responded_at = now()
    where follow_request.id = p_request_id;

    return query
      select 'accepted'::text;
    return;
  end if;

  update public.follow_requests as follow_request
  set
    status = 'rejected',
    responded_at = now()
  where follow_request.id = p_request_id;

  return query
    select 'rejected'::text;
end;
$$;

revoke execute
  on function public.respond_follow_request(uuid, uuid, text)
  from public, anon, authenticated;

grant execute
  on function public.respond_follow_request(uuid, uuid, text)
  to service_role;

commit;
