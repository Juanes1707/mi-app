begin;

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  image_path text not null,
  caption text not null default '',
  created_at timestamptz not null default now(),
  constraint posts_image_path_not_blank_check check (btrim(image_path) <> ''),
  constraint posts_caption_length_check check (char_length(caption) <= 2200)
);

create index posts_author_created_at_idx
  on public.posts (author_id, created_at desc, id desc);

create index posts_created_at_idx
  on public.posts (created_at desc, id desc);

create table public.post_likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint post_likes_pkey primary key (post_id, user_id)
);

create table public.post_comments (
  id uuid default gen_random_uuid(),
  post_id uuid not null,
  author_id uuid not null references public.profiles (id) on delete cascade,
  parent_comment_id uuid,
  body text not null,
  created_at timestamptz not null default now(),
  constraint post_comments_pkey primary key (id),
  constraint post_comments_post_fkey
    foreign key (post_id)
    references public.posts (id)
    on delete cascade,
  constraint post_comments_id_post_id_key unique (id, post_id),
  constraint post_comments_parent_post_fkey
    foreign key (parent_comment_id, post_id)
    references public.post_comments (id, post_id)
    on delete cascade,
  constraint post_comments_no_self_parent_check check (
    parent_comment_id is null or parent_comment_id <> id
  ),
  constraint post_comments_body_not_blank_check check (btrim(body) <> ''),
  constraint post_comments_body_length_check check (char_length(body) <= 500)
);

create index post_comments_post_created_at_idx
  on public.post_comments (post_id, created_at asc, id asc);

create index post_comments_parent_created_at_idx
  on public.post_comments (parent_comment_id, created_at asc, id asc)
  where parent_comment_id is not null;

alter table public.posts enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_comments enable row level security;

revoke all privileges on table public.posts from public, anon, authenticated;
revoke all privileges on table public.post_likes from public, anon, authenticated;
revoke all privileges on table public.post_comments from public, anon, authenticated;

grant select, insert, update, delete
  on table public.posts
  to service_role;

grant select, insert, update, delete
  on table public.post_likes
  to service_role;

grant select, insert, update, delete
  on table public.post_comments
  to service_role;

commit;
