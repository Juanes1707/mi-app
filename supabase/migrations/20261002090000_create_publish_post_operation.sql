begin;

alter table public.posts
  add constraint posts_image_path_unique unique (image_path);

create function public.publish_post(
  p_actor_id uuid,
  p_image_path text,
  p_caption text
)
returns table (
  result_status text,
  post_id uuid,
  author_id uuid,
  image_path text,
  caption text,
  created_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_post_id uuid;
  v_author_id uuid;
  v_image_path text;
  v_caption text;
  v_created_at timestamptz;
begin
  if p_actor_id is null or not exists (
    select 1
    from public.profiles as actor
    where actor.id = p_actor_id
  ) then
    return query
      select
        'profile_not_ready'::text,
        null::uuid,
        null::uuid,
        null::text,
        null::text,
        null::timestamptz;
    return;
  end if;

  if p_image_path is null
    or btrim(p_image_path) = ''
    or btrim(p_image_path) <> p_image_path
    or strpos(p_image_path, p_actor_id::text || '/') <> 1
    or p_caption is null
    or char_length(p_caption) > 2200
  then
    return query
      select
        'invalid_request'::text,
        null::uuid,
        null::uuid,
        null::text,
        null::text,
        null::timestamptz;
    return;
  end if;

  insert into public.posts as inserted_post (author_id, image_path, caption)
  values (p_actor_id, p_image_path, p_caption)
  on conflict on constraint posts_image_path_unique do nothing
  returning
    inserted_post.id,
    inserted_post.author_id,
    inserted_post.image_path,
    inserted_post.caption,
    inserted_post.created_at
  into
    v_post_id,
    v_author_id,
    v_image_path,
    v_caption,
    v_created_at;

  if found then
    return query
      select
        'published'::text,
        v_post_id,
        v_author_id,
        v_image_path,
        v_caption,
        v_created_at;
    return;
  end if;

  select
    existing_post.id,
    existing_post.author_id,
    existing_post.image_path,
    existing_post.caption,
    existing_post.created_at
  into
    v_post_id,
    v_author_id,
    v_image_path,
    v_caption,
    v_created_at
  from public.posts as existing_post
  where existing_post.image_path = p_image_path;

  if not found or v_author_id <> p_actor_id then
    return query
      select
        'invalid_request'::text,
        null::uuid,
        null::uuid,
        null::text,
        null::text,
        null::timestamptz;
    return;
  end if;

  return query
    select
      'already_published'::text,
      v_post_id,
      v_author_id,
      v_image_path,
      v_caption,
      v_created_at;
end;
$$;

revoke execute
  on function public.publish_post(uuid, text, text)
  from public, anon, authenticated;

grant execute
  on function public.publish_post(uuid, text, text)
  to service_role;

commit;
