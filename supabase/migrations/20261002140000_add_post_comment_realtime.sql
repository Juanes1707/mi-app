begin;

-- One comment of a post through the SAME read model as list_post_comments (same
-- columns, same expressions, same authorization), for the targeted read that follows
-- a Realtime invalidation. The comment must belong to the requested post.
create function public.get_post_comment(
  p_actor_id uuid,
  p_post_id uuid,
  p_comment_id uuid
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
  if p_actor_id is null or p_post_id is null or p_comment_id is null then
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

  -- Only after the post is authorized. A comment of another post is
  -- indistinguishable from one that does not exist.
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
    where comment.id = p_comment_id
      and comment.post_id = p_post_id;

  if not found then
    return query
      select
        'comment_not_found'::text,
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
  on function public.get_post_comment(uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute
  on function public.get_post_comment(uuid, uuid, uuid)
  to service_role;

-- Live invalidation hint for a new comment: private Broadcast on the post's topic.
-- Only opaque ids travel (no body, author or parent); receivers re-read the comment
-- through the authorized HTTP read model. AFTER INSERT only: an exact idempotent
-- replay (ON CONFLICT DO NOTHING) inserts no row, so it never broadcasts again.
create function private.broadcast_post_comment_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A broadcast problem must never undo the comment: it is a best-effort hint.
  begin
    perform realtime.send(
      jsonb_build_object('postId', new.post_id::text, 'commentId', new.id::text),
      'comment-created',
      'post-comments:' || new.post_id::text,
      true
    );
  exception
    when others then
      raise warning 'post comment broadcast failed (sqlstate %)', sqlstate;
  end;
  return null;
end;
$$;

revoke all privileges
  on function private.broadcast_post_comment_created()
  from public, anon, authenticated;

create trigger broadcast_post_comment_created_after_insert
  after insert on public.post_comments
  for each row
  execute function private.broadcast_post_comment_created();

-- Who may join (receive on) a private post-comments topic: the authenticated user of
-- the current JWT (never a caller-supplied id), with a profile, who can see the post
-- under exactly the Feed rule. Narrow on purpose: it answers only this question, so
-- authenticated still has no direct access to posts, profiles, follows or comments.
create function private.can_receive_post_comment_broadcast(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_post uuid;
begin
  if v_actor is null
    or p_topic is null
    or p_topic !~ '^post-comments:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    return false;
  end if;

  -- Safe cast: the pattern above only accepts a canonical lowercase UUID.
  v_post := substr(p_topic, char_length('post-comments:') + 1)::uuid;

  return exists (
    select 1
    from public.profiles as actor
    cross join public.posts as post
    join public.profiles as post_author
      on post_author.id = post.author_id
    where actor.id = v_actor
      and post.id = v_post
      and (
        post.author_id = v_actor
        or not post_author.is_private
        or exists (
          select 1
          from public.follows as active_follow
          where active_follow.follower_id = v_actor
            and active_follow.followed_id = post.author_id
        )
      )
  );
end;
$$;

revoke all privileges
  on function private.can_receive_post_comment_broadcast(text)
  from public, anon, authenticated;

-- Only what the policy below needs when Realtime evaluates it as `authenticated`.
grant usage on schema private to authenticated;
grant execute
  on function private.can_receive_post_comment_broadcast(text)
  to authenticated;

-- Receive-only: clients may read broadcasts of topics they can see; there is no
-- INSERT policy, so clients cannot send on these topics. RLS on realtime.messages is
-- managed by Supabase and is not altered here.
create policy authenticated_receive_visible_post_comment_broadcasts
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and private.can_receive_post_comment_broadcast((select realtime.topic()))
  );

commit;
