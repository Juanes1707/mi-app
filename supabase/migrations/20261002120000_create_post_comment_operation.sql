begin;

-- Creates one immutable comment identity. The client-generated comment UUID is
-- reused by retries, so an identical retry returns the original row while a
-- different payload using the same UUID is rejected.
create function public.create_post_comment(
  p_actor_id uuid,
  p_comment_id uuid,
  p_post_id uuid,
  p_parent_comment_id uuid,
  p_body text
)
returns table (
  status text,
  comment_id uuid,
  post_id uuid,
  parent_comment_id uuid,
  author_id uuid,
  body text,
  created_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_comment public.post_comments%rowtype;
begin
  if p_actor_id is null
    or p_comment_id is null
    or p_post_id is null
    or p_body is null
    or char_length(p_body) > 500
    or btrim(p_body) = ''
  then
    return query
      select
        'invalid_request'::text,
        null::uuid,
        null::uuid,
        null::uuid,
        null::uuid,
        null::text,
        null::timestamptz;
    return;
  end if;

  -- Keep the profile alive until the insert finishes so its foreign key cannot
  -- escape as a technical error during a concurrent profile deletion.
  perform 1
  from public.profiles as actor
  where actor.id = p_actor_id
  for key share;

  if not found then
    return query
      select
        'profile_not_ready'::text,
        null::uuid,
        null::uuid,
        null::uuid,
        null::uuid,
        null::text,
        null::timestamptz;
    return;
  end if;

  -- A missing post and a post hidden by privacy deliberately have the same
  -- result. Only an active follows row authorizes access to a private author.
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
    )
  for key share of post;

  if not found then
    return query
      select
        'not_found'::text,
        null::uuid,
        null::uuid,
        null::uuid,
        null::uuid,
        null::text,
        null::timestamptz;
    return;
  end if;

  if p_parent_comment_id is not null then
    -- The composite lookup enforces the same-post rule without revealing whether
    -- the UUID exists under a different post. This lock also closes a delete race.
    perform 1
    from public.post_comments as parent_comment
    where parent_comment.id = p_parent_comment_id
      and parent_comment.post_id = p_post_id
    for key share;

    if not found then
      return query
        select
          'parent_not_found'::text,
          null::uuid,
          null::uuid,
          null::uuid,
          null::uuid,
          null::text,
          null::timestamptz;
      return;
    end if;
  end if;

  insert into public.post_comments as new_comment (
    id,
    post_id,
    author_id,
    parent_comment_id,
    body
  )
  values (
    p_comment_id,
    p_post_id,
    p_actor_id,
    p_parent_comment_id,
    p_body
  )
  on conflict on constraint post_comments_pkey do nothing
  returning new_comment.*
  into v_comment;

  if found then
    return query
      select
        'created'::text,
        v_comment.id,
        v_comment.post_id,
        v_comment.parent_comment_id,
        v_comment.author_id,
        v_comment.body,
        v_comment.created_at;
    return;
  end if;

  -- ON CONFLICT waits for a concurrent winner. This following command then sees
  -- its committed row under READ COMMITTED and can classify the retry precisely.
  select existing_comment.*
  into v_comment
  from public.post_comments as existing_comment
  where existing_comment.id = p_comment_id;

  if found
    and v_comment.author_id = p_actor_id
    and v_comment.post_id = p_post_id
    and v_comment.parent_comment_id is not distinct from p_parent_comment_id
    and v_comment.body = p_body
  then
    return query
      select
        'already_created'::text,
        v_comment.id,
        v_comment.post_id,
        v_comment.parent_comment_id,
        v_comment.author_id,
        v_comment.body,
        v_comment.created_at;
    return;
  end if;

  -- A conflicting row is intentionally never returned to the caller.
  return query
    select
      'comment_id_conflict'::text,
      null::uuid,
      null::uuid,
      null::uuid,
      null::uuid,
      null::text,
      null::timestamptz;
end;
$$;

revoke execute
  on function public.create_post_comment(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;

grant execute
  on function public.create_post_comment(uuid, uuid, uuid, uuid, text)
  to service_role;

commit;
