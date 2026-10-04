begin;

-- The UUID tiebreak makes the existing timestamp order total and lets a cursor
-- continue through multiple relationships created in the same transaction.
create index follows_followers_page_idx
  on public.follows (followed_id, created_at desc, follower_id desc);

create index follows_following_page_idx
  on public.follows (follower_id, created_at desc, followed_id desc);

create function public.list_profile_followers(
  p_actor_id uuid,
  p_target_id uuid,
  p_limit integer,
  p_before_created_at timestamptz default null,
  p_before_user_id uuid default null
)
returns table (
  result_status text,
  profile_id uuid,
  username text,
  display_name text,
  is_private boolean,
  connection_created_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_target_is_private boolean;
  v_rows bigint;
begin
  if p_actor_id is null or p_target_id is null or p_limit is null or p_limit < 1 or p_limit > 51
    or ((p_before_created_at is null) <> (p_before_user_id is null)) then
    return query select 'invalid_request'::text, null::uuid, null::text, null::text,
      null::boolean, null::timestamptz;
    return;
  end if;

  if not exists (select 1 from public.profiles as actor where actor.id = p_actor_id) then
    return query select 'profile_not_ready'::text, null::uuid, null::text, null::text,
      null::boolean, null::timestamptz;
    return;
  end if;

  select target.is_private
  into v_target_is_private
  from public.profiles as target
  where target.id = p_target_id;

  if not found or (
    v_target_is_private
    and p_actor_id <> p_target_id
    and not exists (
      select 1
      from public.follows as access_follow
      where access_follow.follower_id = p_actor_id
        and access_follow.followed_id = p_target_id
    )
  ) then
    -- Hidden private targets and missing targets deliberately share one result.
    return query select 'profile_not_found'::text, null::uuid, null::text, null::text,
      null::boolean, null::timestamptz;
    return;
  end if;

  return query
    select
      'ok'::text,
      member.id,
      member.username,
      member.display_name,
      member.is_private,
      connection.created_at
    from public.follows as connection
    join public.profiles as member on member.id = connection.follower_id
    where connection.followed_id = p_target_id
      and (
        p_before_created_at is null
        or connection.created_at < p_before_created_at
        or (
          connection.created_at = p_before_created_at
          and connection.follower_id < p_before_user_id
        )
      )
    order by connection.created_at desc, connection.follower_id desc
    limit p_limit;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return query select 'ok'::text, null::uuid, null::text, null::text,
      null::boolean, null::timestamptz;
  end if;
end;
$$;

create function public.list_profile_following(
  p_actor_id uuid,
  p_target_id uuid,
  p_limit integer,
  p_before_created_at timestamptz default null,
  p_before_user_id uuid default null
)
returns table (
  result_status text,
  profile_id uuid,
  username text,
  display_name text,
  is_private boolean,
  connection_created_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_target_is_private boolean;
  v_rows bigint;
begin
  if p_actor_id is null or p_target_id is null or p_limit is null or p_limit < 1 or p_limit > 51
    or ((p_before_created_at is null) <> (p_before_user_id is null)) then
    return query select 'invalid_request'::text, null::uuid, null::text, null::text,
      null::boolean, null::timestamptz;
    return;
  end if;

  if not exists (select 1 from public.profiles as actor where actor.id = p_actor_id) then
    return query select 'profile_not_ready'::text, null::uuid, null::text, null::text,
      null::boolean, null::timestamptz;
    return;
  end if;

  select target.is_private
  into v_target_is_private
  from public.profiles as target
  where target.id = p_target_id;

  if not found or (
    v_target_is_private
    and p_actor_id <> p_target_id
    and not exists (
      select 1
      from public.follows as access_follow
      where access_follow.follower_id = p_actor_id
        and access_follow.followed_id = p_target_id
    )
  ) then
    return query select 'profile_not_found'::text, null::uuid, null::text, null::text,
      null::boolean, null::timestamptz;
    return;
  end if;

  return query
    select
      'ok'::text,
      member.id,
      member.username,
      member.display_name,
      member.is_private,
      connection.created_at
    from public.follows as connection
    join public.profiles as member on member.id = connection.followed_id
    where connection.follower_id = p_target_id
      and (
        p_before_created_at is null
        or connection.created_at < p_before_created_at
        or (
          connection.created_at = p_before_created_at
          and connection.followed_id < p_before_user_id
        )
      )
    order by connection.created_at desc, connection.followed_id desc
    limit p_limit;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return query select 'ok'::text, null::uuid, null::text, null::text,
      null::boolean, null::timestamptz;
  end if;
end;
$$;

revoke execute
  on function public.list_profile_followers(uuid, uuid, integer, timestamptz, uuid)
  from public, anon, authenticated;

revoke execute
  on function public.list_profile_following(uuid, uuid, integer, timestamptz, uuid)
  from public, anon, authenticated;

grant execute
  on function public.list_profile_followers(uuid, uuid, integer, timestamptz, uuid)
  to service_role;

grant execute
  on function public.list_profile_following(uuid, uuid, integer, timestamptz, uuid)
  to service_role;

commit;
