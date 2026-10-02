begin;

create function public.request_follow(
  p_requester_id uuid,
  p_target_id uuid
)
returns table (
  result_status text,
  request_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_target_is_private boolean;
  v_request_id uuid;
begin
  if not exists (
    select 1
    from public.profiles as requester
    where requester.id = p_requester_id
  ) then
    return query
      select 'requester_profile_not_found'::text, null::uuid;
    return;
  end if;

  if p_requester_id = p_target_id then
    return query
      select 'self_follow'::text, null::uuid;
    return;
  end if;

  select target.is_private
  into v_target_is_private
  from public.profiles as target
  where target.id = p_target_id
  for update;

  if not found then
    return query
      select 'target_not_found'::text, null::uuid;
    return;
  end if;

  if exists (
    select 1
    from public.follows as existing_follow
    where existing_follow.follower_id = p_requester_id
      and existing_follow.followed_id = p_target_id
  ) then
    if not v_target_is_private then
      update public.follow_requests as pending_request
      set
        status = 'accepted',
        responded_at = now()
      where pending_request.requester_id = p_requester_id
        and pending_request.target_id = p_target_id
        and pending_request.status = 'pending';
    end if;

    return query
      select 'following'::text, null::uuid;
    return;
  end if;

  if not v_target_is_private then
    insert into public.follows (follower_id, followed_id)
    values (p_requester_id, p_target_id)
    on conflict (follower_id, followed_id) do nothing;

    update public.follow_requests as pending_request
    set
      status = 'accepted',
      responded_at = now()
    where pending_request.requester_id = p_requester_id
      and pending_request.target_id = p_target_id
      and pending_request.status = 'pending';

    return query
      select 'following'::text, null::uuid;
    return;
  end if;

  insert into public.follow_requests (requester_id, target_id, status)
  values (p_requester_id, p_target_id, 'pending')
  on conflict (requester_id, target_id) where status = 'pending'
  do nothing
  returning id into v_request_id;

  if v_request_id is null then
    select pending_request.id
    into v_request_id
    from public.follow_requests as pending_request
    where pending_request.requester_id = p_requester_id
      and pending_request.target_id = p_target_id
      and pending_request.status = 'pending';
  end if;

  return query
    select 'request_pending'::text, v_request_id;
end;
$$;

revoke execute
  on function public.request_follow(uuid, uuid)
  from public, anon, authenticated;

grant execute
  on function public.request_follow(uuid, uuid)
  to service_role;

commit;
