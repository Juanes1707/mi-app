begin;

create function public.authorize_post_media_read(
  p_actor_id uuid,
  p_image_path text
)
returns table (
  post_id uuid,
  image_path text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    post.id as post_id,
    post.image_path
  from public.posts as post
  join public.profiles as author
    on author.id = post.author_id
  where p_actor_id is not null
    and p_image_path is not null
    and post.image_path = p_image_path
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
  limit 1;
$$;

revoke execute
  on function public.authorize_post_media_read(uuid, text)
  from public, anon, authenticated;

grant execute
  on function public.authorize_post_media_read(uuid, text)
  to service_role;

commit;
