begin;

-- Targeted authorized read for deep links and Post Detail. Its successful row is
-- intentionally the same projection and uses the same privacy rule as Feed.
create function public.get_post(
  p_actor_id uuid,
  p_post_id uuid
)
returns table (
  status text,
  post_id uuid,
  author_id uuid,
  author_username text,
  author_display_name text,
  image_path text,
  caption text,
  created_at timestamptz,
  likes_count integer,
  comments_count integer,
  is_liked boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_actor_id is null or p_post_id is null then
    return query
      select 'invalid_request'::text, null::uuid, null::uuid, null::text,
        null::text, null::text, null::text, null::timestamptz,
        null::integer, null::integer, null::boolean;
    return;
  end if;

  perform 1
  from public.profiles as actor
  where actor.id = p_actor_id;

  if not found then
    return query
      select 'profile_not_ready'::text, null::uuid, null::uuid, null::text,
        null::text, null::text, null::text, null::timestamptz,
        null::integer, null::integer, null::boolean;
    return;
  end if;

  return query
    select
      'ok'::text,
      post.id,
      post.author_id,
      author.username,
      author.display_name,
      post.image_path,
      post.caption,
      post.created_at,
      (
        select count(*)::integer
        from public.post_likes as post_like
        where post_like.post_id = post.id
      ),
      (
        select count(*)::integer
        from public.post_comments as post_comment
        where post_comment.post_id = post.id
      ),
      exists (
        select 1
        from public.post_likes as actor_like
        where actor_like.post_id = post.id
          and actor_like.user_id = p_actor_id
      )
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
      );

  if not found then
    -- Missing and hidden posts deliberately have the same data-free result.
    return query
      select 'not_found'::text, null::uuid, null::uuid, null::text,
        null::text, null::text, null::text, null::timestamptz,
        null::integer, null::integer, null::boolean;
  end if;
end;
$$;

revoke execute
  on function public.get_post(uuid, uuid)
  from public, anon, authenticated;

grant execute
  on function public.get_post(uuid, uuid)
  to service_role;

commit;
