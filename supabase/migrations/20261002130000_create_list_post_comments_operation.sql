begin;

-- Root pages walk only root comments of a post, in keyset order.
create index post_comments_post_root_created_at_idx
  on public.post_comments (post_id, created_at asc, id asc)
  where parent_comment_id is null;

-- Root comments and direct replies share one bounded read model. Callers select
-- one sibling set with p_parent_comment_id and walk deeper levels explicitly.
create function public.list_post_comments(
  p_actor_id uuid,
  p_post_id uuid,
  p_parent_comment_id uuid,
  p_limit integer,
  p_after_created_at timestamptz,
  p_after_comment_id uuid
)
returns table (
  status text,
  comment_id uuid,
  post_id uuid,
  parent_comment_id uuid,
  body text,
  created_at timestamptz,
  author_id uuid,
  author_username text,
  author_display_name text,
  direct_replies_count integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_actor_id is null
    or p_post_id is null
    or p_limit is null
    or p_limit < 1
    or p_limit > 51
    or ((p_after_created_at is null) <> (p_after_comment_id is null))
  then
    return query
      select
        'invalid_request'::text,
        null::uuid,
        null::uuid,
        null::uuid,
        null::text,
        null::timestamptz,
        null::uuid,
        null::text,
        null::text,
        null::integer;
    return;
  end if;

  perform 1
  from public.profiles as actor
  where actor.id = p_actor_id;

  if not found then
    return query
      select
        'profile_not_ready'::text,
        null::uuid,
        null::uuid,
        null::uuid,
        null::text,
        null::timestamptz,
        null::uuid,
        null::text,
        null::text,
        null::integer;
    return;
  end if;

  -- Missing and currently hidden posts deliberately share the same result.
  perform 1
  from public.posts as post
  join public.profiles as post_author
    on post_author.id = post.author_id
  where post.id = p_post_id
    and (
      post.author_id = p_actor_id
      or not post_author.is_private
      or exists (
        select 1
        from public.follows as active_follow
        where active_follow.follower_id = p_actor_id
          and active_follow.followed_id = post.author_id
      )
    );

  if not found then
    return query
      select
        'not_found'::text,
        null::uuid,
        null::uuid,
        null::uuid,
        null::text,
        null::timestamptz,
        null::uuid,
        null::text,
        null::text,
        null::integer;
    return;
  end if;

  -- Check the parent only after post authorization. A parent under another post
  -- is indistinguishable from a UUID that does not exist.
  if p_parent_comment_id is not null then
    perform 1
    from public.post_comments as requested_parent
    where requested_parent.id = p_parent_comment_id
      and requested_parent.post_id = p_post_id;

    if not found then
      return query
        select
          'parent_not_found'::text,
          null::uuid,
          null::uuid,
          null::uuid,
          null::text,
          null::timestamptz,
          null::uuid,
          null::text,
          null::text,
          null::integer;
      return;
    end if;
  end if;

  -- Two branches so each sibling set walks its own index in (created_at, id) order:
  -- roots use post_comments_post_root_created_at_idx, direct replies use the partial
  -- parent index. A single `parent IS NOT DISTINCT FROM $param` predicate is not
  -- indexable and would scan and discard the post's other comments.
  if p_parent_comment_id is null then
    return query
      select
        'ok'::text,
        comment.id,
        comment.post_id,
        comment.parent_comment_id,
        comment.body,
        comment.created_at,
        author.id,
        author.username,
        author.display_name,
        (
          select count(*)::integer
          from public.post_comments as direct_reply
          where direct_reply.parent_comment_id = comment.id
        )
      from public.post_comments as comment
      join public.profiles as author
        on author.id = comment.author_id
      where comment.post_id = p_post_id
        and comment.parent_comment_id is null
        and (
          p_after_created_at is null
          or comment.created_at > p_after_created_at
          or (
            comment.created_at = p_after_created_at
            and comment.id > p_after_comment_id
          )
        )
      order by comment.created_at asc, comment.id asc
      limit p_limit;
  else
    return query
      select
        'ok'::text,
        comment.id,
        comment.post_id,
        comment.parent_comment_id,
        comment.body,
        comment.created_at,
        author.id,
        author.username,
        author.display_name,
        (
          select count(*)::integer
          from public.post_comments as direct_reply
          where direct_reply.parent_comment_id = comment.id
        )
      from public.post_comments as comment
      join public.profiles as author
        on author.id = comment.author_id
      where comment.parent_comment_id = p_parent_comment_id
        and comment.post_id = p_post_id
        and (
          p_after_created_at is null
          or comment.created_at > p_after_created_at
          or (
            comment.created_at = p_after_created_at
            and comment.id > p_after_comment_id
          )
        )
      order by comment.created_at asc, comment.id asc
      limit p_limit;
  end if;

  if not found then
    -- The sentinel lets one RPC distinguish a visible empty sibling set from a
    -- hidden/missing post or parent.
    return query
      select
        'ok'::text,
        null::uuid,
        null::uuid,
        null::uuid,
        null::text,
        null::timestamptz,
        null::uuid,
        null::text,
        null::text,
        null::integer;
  end if;
end;
$$;

revoke execute
  on function public.list_post_comments(uuid, uuid, uuid, integer, timestamptz, uuid)
  from public, anon, authenticated;

grant execute
  on function public.list_post_comments(uuid, uuid, uuid, integer, timestamptz, uuid)
  to service_role;

commit;
