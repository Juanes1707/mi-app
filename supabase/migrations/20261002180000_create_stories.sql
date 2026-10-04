begin;

-- ============================================================== Storage
-- Private bucket with the same limits as post-media. No client policies: bytes move
-- only through short-lived, single-object capabilities issued by Edge Functions.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'story-media',
  'story-media',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ============================================================== stories
-- The id is created on the device before the upload (no default). A Story is ACTIVE
-- while created_at + 24 hours > current_timestamp (server clock, microseconds); at
-- exactly 24 hours it is expired. There is no stored status: expiry is derived, never
-- updated by a job. image_path is the Storage object path (never a URL) and is fully
-- determined by the row: '<author_id>/<id>.<jpg|png|webp>'.
create table public.stories (
  id uuid primary key,
  author_id uuid not null references public.profiles (id) on delete cascade,
  image_path text not null,
  created_at timestamptz not null default now(),
  constraint stories_image_path_not_blank_check check (btrim(image_path) <> ''),
  constraint stories_image_path_matches_story_check check (
    image_path in (
      author_id::text || '/' || id::text || '.jpg',
      author_id::text || '/' || id::text || '.png',
      author_id::text || '/' || id::text || '.webp'
    )
  )
);

-- Per-author active window (tray aggregate, author list ASC via backward scan).
create index stories_author_created_at_idx
  on public.stories (author_id, created_at desc, id desc);

alter table public.stories enable row level security;

revoke all privileges on table public.stories from public, anon, authenticated;

grant select, insert, update, delete
  on table public.stories
  to service_role;

-- ============================================================== prepare upload
-- Before a signed upload capability is issued: the actor has a profile and the id is
-- not taken by any published Story (a published object is never replaced). Two columns
-- on purpose: a one-column RETURNS TABLE is a scalar SETOF text, not a row.
create function public.prepare_story_upload(
  p_actor_id uuid,
  p_story_id uuid
)
returns table (status text, story_id uuid)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_actor_id is null or p_story_id is null then
    return query select 'invalid_request'::text, null::uuid;
    return;
  end if;

  if not exists (select 1 from public.profiles as actor where actor.id = p_actor_id) then
    return query select 'profile_not_ready'::text, null::uuid;
    return;
  end if;

  if exists (select 1 from public.stories as story where story.id = p_story_id) then
    return query select 'story_id_conflict'::text, null::uuid;
    return;
  end if;

  return query select 'ok'::text, p_story_id;
end;
$$;

-- ============================================================== publish
-- Idempotent on the client-generated id. An exact replay (same id, actor and path)
-- returns the ORIGINAL row: created_at is never renewed, so a retry can never bring an
-- expired Story back. The same id with another actor or path is a conflict.
create function public.publish_story(
  p_actor_id uuid,
  p_story_id uuid,
  p_image_path text
)
returns table (
  status text,
  story_id uuid,
  author_id uuid,
  image_path text,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_story public.stories%rowtype;
begin
  if p_actor_id is null or p_story_id is null or p_image_path is null or
     p_image_path not in (
       p_actor_id::text || '/' || p_story_id::text || '.jpg',
       p_actor_id::text || '/' || p_story_id::text || '.png',
       p_actor_id::text || '/' || p_story_id::text || '.webp'
     ) then
    return query select 'invalid_request'::text, null::uuid, null::uuid, null::text,
      null::timestamptz, null::timestamptz;
    return;
  end if;

  if not exists (select 1 from public.profiles as actor where actor.id = p_actor_id) then
    return query select 'profile_not_ready'::text, null::uuid, null::uuid, null::text,
      null::timestamptz, null::timestamptz;
    return;
  end if;

  insert into public.stories as inserted (id, author_id, image_path)
  values (p_story_id, p_actor_id, p_image_path)
  on conflict (id) do nothing
  returning inserted.* into v_story;

  if found then
    return query select 'created'::text, v_story.id, v_story.author_id, v_story.image_path,
      v_story.created_at, v_story.created_at + interval '24 hours';
    return;
  end if;

  select * into v_story from public.stories as story where story.id = p_story_id;

  if found and v_story.author_id = p_actor_id and v_story.image_path = p_image_path then
    return query select 'already_created'::text, v_story.id, v_story.author_id, v_story.image_path,
      v_story.created_at, v_story.created_at + interval '24 hours';
    return;
  end if;

  return query select 'story_id_conflict'::text, null::uuid, null::uuid, null::text,
    null::timestamptz, null::timestamptz;
end;
$$;

-- ============================================================== tray
-- Home tray: the actor and the accounts the actor FOLLOWS (follows rows only: no
-- pending/accepted-history requests, no inverse follows, no unfollowed public
-- profiles), each with at least one active Story. Order is total and keyset-paginated:
--   is_self DESC, latest_story_created_at DESC, author_id DESC
-- and the cursor carries all three dimensions, so crossing self -> followed is exact.
create function public.list_story_trays(
  p_actor_id uuid,
  p_limit integer,
  p_before_is_self boolean,
  p_before_latest_created_at timestamptz,
  p_before_author_id uuid
)
returns table (
  status text,
  author_id uuid,
  author_username text,
  author_display_name text,
  latest_story_created_at timestamptz,
  active_story_count integer,
  is_self boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_actor_id is null or p_limit is null or p_limit < 1 or p_limit > 51 or
     not (
       (p_before_is_self is null and p_before_latest_created_at is null and p_before_author_id is null) or
       (p_before_is_self is not null and p_before_latest_created_at is not null and p_before_author_id is not null)
     ) or
     -- A self cursor can only name the actor.
     (p_before_is_self and p_before_author_id <> p_actor_id) then
    return query select 'invalid_request'::text, null::uuid, null::text, null::text,
      null::timestamptz, null::integer, null::boolean;
    return;
  end if;

  if not exists (select 1 from public.profiles as actor where actor.id = p_actor_id) then
    return query select 'profile_not_ready'::text, null::uuid, null::text, null::text,
      null::timestamptz, null::integer, null::boolean;
    return;
  end if;

  return query
    with candidates as (
      select p_actor_id as candidate_id
      union
      select follow.followed_id
      from public.follows as follow
      where follow.follower_id = p_actor_id
    ),
    trays as (
      select
        candidate.candidate_id as tray_author_id,
        candidate.candidate_id = p_actor_id as tray_is_self,
        active.latest_created_at,
        active.story_count
      from candidates as candidate
      cross join lateral (
        select max(story.created_at) as latest_created_at, count(*)::integer as story_count
        from public.stories as story
        where story.author_id = candidate.candidate_id
          and story.created_at > current_timestamp - interval '24 hours'
      ) as active
      where active.story_count > 0
    )
    select 'ok'::text, tray.tray_author_id, author.username, author.display_name,
      tray.latest_created_at, tray.story_count, tray.tray_is_self
    from trays as tray
    join public.profiles as author
      on author.id = tray.tray_author_id
    where p_before_is_self is null
       or (tray.tray_is_self, tray.latest_created_at, tray.tray_author_id)
          < (p_before_is_self, p_before_latest_created_at, p_before_author_id)
    order by tray.tray_is_self desc, tray.latest_created_at desc, tray.tray_author_id desc
    limit p_limit;

  if not found then
    return query select 'ok'::text, null::uuid, null::text, null::text,
      null::timestamptz, null::integer, null::boolean;
  end if;
end;
$$;

-- ============================================================== stories of one author
-- Active Stories of a VISIBLE author (self, public, or followed: the Posts rule), oldest
-- first for sequential playback: created_at ASC, id ASC, keyset after a cursor. A
-- missing author and a private author the actor may not see share one result.
create function public.list_active_stories(
  p_actor_id uuid,
  p_author_id uuid,
  p_limit integer,
  p_after_created_at timestamptz,
  p_after_story_id uuid
)
returns table (
  status text,
  story_id uuid,
  author_id uuid,
  author_username text,
  author_display_name text,
  image_path text,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_actor_id is null or p_author_id is null or p_limit is null or p_limit < 1 or p_limit > 51 or
     ((p_after_created_at is null) <> (p_after_story_id is null)) then
    return query select 'invalid_request'::text, null::uuid, null::uuid, null::text, null::text,
      null::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  if not exists (select 1 from public.profiles as actor where actor.id = p_actor_id) then
    return query select 'profile_not_ready'::text, null::uuid, null::uuid, null::text, null::text,
      null::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  if not exists (
    select 1
    from public.profiles as author
    where author.id = p_author_id
      and (
        author.id = p_actor_id
        or not author.is_private
        or exists (
          select 1
          from public.follows as active_follow
          where active_follow.follower_id = p_actor_id
            and active_follow.followed_id = author.id
        )
      )
  ) then
    return query select 'author_not_found'::text, null::uuid, null::uuid, null::text, null::text,
      null::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  return query
    select 'ok'::text, story.id, story.author_id, author.username, author.display_name,
      story.image_path, story.created_at, story.created_at + interval '24 hours'
    from public.stories as story
    join public.profiles as author
      on author.id = story.author_id
    where story.author_id = p_author_id
      and story.created_at > current_timestamp - interval '24 hours'
      and (
        p_after_created_at is null
        or (story.created_at, story.id) > (p_after_created_at, p_after_story_id)
      )
    order by story.created_at asc, story.id asc
    limit p_limit;

  if not found then
    return query select 'ok'::text, null::uuid, null::uuid, null::text, null::text,
      null::text, null::timestamptz, null::timestamptz;
  end if;
end;
$$;

-- ============================================================== media authorization
-- The authorization behind every signed read: the Story exists, is ACTIVE now and its
-- author is visible to the actor. Missing, expired and hidden are one public result.
create function public.get_story_media(
  p_actor_id uuid,
  p_story_id uuid
)
returns table (
  status text,
  story_id uuid,
  image_path text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_actor_id is null or p_story_id is null then
    return query select 'invalid_request'::text, null::uuid, null::text;
    return;
  end if;

  if not exists (select 1 from public.profiles as actor where actor.id = p_actor_id) then
    return query select 'profile_not_ready'::text, null::uuid, null::text;
    return;
  end if;

  return query
    select 'ok'::text, story.id, story.image_path
    from public.stories as story
    join public.profiles as author
      on author.id = story.author_id
    where story.id = p_story_id
      and story.created_at > current_timestamp - interval '24 hours'
      and (
        story.author_id = p_actor_id
        or not author.is_private
        or exists (
          select 1
          from public.follows as active_follow
          where active_follow.follower_id = p_actor_id
            and active_follow.followed_id = story.author_id
        )
      );

  if not found then
    return query select 'story_not_found'::text, null::uuid, null::text;
  end if;
end;
$$;

revoke execute on function public.prepare_story_upload(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.publish_story(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.list_story_trays(uuid, integer, boolean, timestamptz, uuid) from public, anon, authenticated;
revoke execute on function public.list_active_stories(uuid, uuid, integer, timestamptz, uuid) from public, anon, authenticated;
revoke execute on function public.get_story_media(uuid, uuid) from public, anon, authenticated;

grant execute on function public.prepare_story_upload(uuid, uuid) to service_role;
grant execute on function public.publish_story(uuid, uuid, text) to service_role;
grant execute on function public.list_story_trays(uuid, integer, boolean, timestamptz, uuid) to service_role;
grant execute on function public.list_active_stories(uuid, uuid, integer, timestamptz, uuid) to service_role;
grant execute on function public.get_story_media(uuid, uuid) to service_role;

commit;
