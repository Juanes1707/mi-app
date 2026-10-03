begin;

-- Sets the actor's like on a post to a DESIRED state (never a toggle), so retries,
-- timeouts and offline replays of the same command converge to the same result.
--
-- `not_found` deliberately covers both "post does not exist" and "actor may not see
-- it", and never carries post data (liked / likes_count are null).
create function public.set_post_like(
  p_actor_id uuid,
  p_post_id uuid,
  p_liked boolean
)
returns table (
  status text,
  post_id uuid,
  liked boolean,
  likes_count integer
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_is_visible boolean;
  v_liked boolean;
  v_likes_count integer;
begin
  if p_liked is null then
    raise exception 'p_liked must not be null'
      using errcode = 'null_value_not_allowed';
  end if;

  -- KEY SHARE keeps the actor profile from disappearing before the like is written,
  -- so a foreign key error can never become the HTTP contract.
  perform 1
  from public.profiles as actor
  where actor.id = p_actor_id
  for key share;

  if p_actor_id is null or not found then
    return query
      select 'profile_not_ready'::text, p_post_id, null::boolean, null::integer;
    return;
  end if;

  if not p_liked then
    -- Removing the actor's OWN like is always allowed, even if the post is no longer
    -- visible (offline unlike after access was revoked). Whether that happened is
    -- not revealed: a hidden post still answers not_found below.
    delete from public.post_likes as own_like
    where own_like.post_id = p_post_id
      and own_like.user_id = p_actor_id;
  end if;

  -- Current visibility: self, public author, or an ACTIVE follow. follow_requests
  -- (pending or historically accepted) never authorize. KEY SHARE on the post keeps
  -- it from being deleted between this check and the insert below.
  select true
  into v_is_visible
  from public.posts as post
  join public.profiles as author
    on author.id = post.author_id
  where post.id = p_post_id
    and (
      post.author_id = p_actor_id
      or not author.is_private
      or exists (
        select 1
        from public.follows as active_follow
        where active_follow.follower_id = p_actor_id
          and active_follow.followed_id = post.author_id
      )
    )
  for key share of post;

  if not found then
    return query
      select 'not_found'::text, p_post_id, null::boolean, null::integer;
    return;
  end if;

  if p_liked then
    -- The primary key (post_id, user_id) is the final defence: concurrent or repeated
    -- likes converge to exactly one row.
    insert into public.post_likes (post_id, user_id)
    values (p_post_id, p_actor_id)
    on conflict on constraint post_likes_pkey do nothing;
  end if;

  -- Authoritative final state, read from the table after the mutation (one snapshot).
  select
    exists (
      select 1
      from public.post_likes as own_like
      where own_like.post_id = p_post_id
        and own_like.user_id = p_actor_id
    ),
    (
      select count(*)::integer
      from public.post_likes as post_like
      where post_like.post_id = p_post_id
    )
  into v_liked, v_likes_count;

  return query
    select 'updated'::text, p_post_id, v_liked, v_likes_count;
end;
$$;

revoke execute
  on function public.set_post_like(uuid, uuid, boolean)
  from public, anon, authenticated;

grant execute
  on function public.set_post_like(uuid, uuid, boolean)
  to service_role;

commit;
