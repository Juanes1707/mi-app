begin;

-- ============================================================== targeted read
-- One message through the SAME read model as list_direct_messages (same columns,
-- same expressions, same participant rule). It is the authorized read behind every
-- Realtime hint: a Broadcast only carries ids. A missing conversation and one the
-- actor is not part of share one result; only then is the message looked up, and a
-- message of another conversation is indistinguishable from a missing one.
create function public.get_direct_message(
  p_actor_id uuid,
  p_conversation_id uuid,
  p_message_id uuid
)
returns table (
  status text,
  message_id uuid,
  conversation_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_actor_id is null or p_conversation_id is null or p_message_id is null then
    return query select 'invalid_request'::text, null::uuid, null::uuid, null::uuid,
      null::text, null::timestamptz, null::timestamptz, null::timestamptz;
    return;
  end if;

  if not exists (select 1 from public.profiles as actor where actor.id = p_actor_id) then
    return query select 'profile_not_ready'::text, null::uuid, null::uuid, null::uuid,
      null::text, null::timestamptz, null::timestamptz, null::timestamptz;
    return;
  end if;

  if not exists (
    select 1 from public.direct_conversations as conversation
    where conversation.id = p_conversation_id
      and p_actor_id in (conversation.participant_low_id, conversation.participant_high_id)
  ) then
    return query select 'conversation_not_found'::text, null::uuid, null::uuid, null::uuid,
      null::text, null::timestamptz, null::timestamptz, null::timestamptz;
    return;
  end if;

  return query
    select 'ok'::text, message.id, message.conversation_id, message.sender_id,
      message.body, message.created_at, message.delivered_at, message.read_at
    from public.direct_messages as message
    where message.id = p_message_id
      and message.conversation_id = p_conversation_id;

  if not found then
    return query select 'message_not_found'::text, null::uuid, null::uuid, null::uuid,
      null::text, null::timestamptz, null::timestamptz, null::timestamptz;
  end if;
end;
$$;

revoke execute on function public.get_direct_message(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_direct_message(uuid, uuid, uuid) to service_role;

-- ============================================================== broadcast plumbing
-- Instants travel as UTC with all six fraction digits: one spelling whatever the
-- session time zone, without losing the microseconds that order messages.
create function private.direct_realtime_timestamp(p_value timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(p_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$$;

-- Private Broadcast, best effort: a Realtime problem is only a WARNING, so it never
-- undoes the durable change that triggered it (message or receipt).
create function private.send_direct_broadcast(p_payload jsonb, p_event text, p_topic text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(p_payload, p_event, p_topic, true);
exception
  when others then
    raise warning 'direct message broadcast failed (sqlstate %)', sqlstate;
end;
$$;

-- message-created hint: only opaque ids and the order key (no body, no receipts, no
-- peer). One copy to the conversation topic and one to each participant's inbox.
-- AFTER INSERT only: an exact replay (ON CONFLICT DO NOTHING) and a message id
-- conflict insert no row, so they never broadcast again.
create function private.broadcast_direct_message_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_low uuid;
  v_high uuid;
  v_payload jsonb;
begin
  select conversation.participant_low_id, conversation.participant_high_id
    into v_low, v_high
  from public.direct_conversations as conversation
  where conversation.id = new.conversation_id;

  v_payload := jsonb_build_object(
    'conversationId', new.conversation_id::text,
    'messageId', new.id::text,
    'senderId', new.sender_id::text,
    'createdAt', private.direct_realtime_timestamp(new.created_at)
  );

  perform private.send_direct_broadcast(v_payload, 'message-created',
    'direct-conversation:' || new.conversation_id::text);
  perform private.send_direct_broadcast(v_payload, 'message-created', 'direct-inbox:' || v_low::text);
  perform private.send_direct_broadcast(v_payload, 'message-created', 'direct-inbox:' || v_high::text);
  return null;
exception
  when others then
    raise warning 'direct message created broadcast failed (sqlstate %)', sqlstate;
    return null;
end;
$$;

create trigger broadcast_direct_message_created_after_insert
  after insert on public.direct_messages
  for each row
  execute function private.broadcast_direct_message_created();

-- message-receipt hint: whose messages advanced (messageSenderId), up to which
-- message (the high-watermark) and when. No body.
create function private.broadcast_direct_message_receipt(
  p_conversation_id uuid,
  p_message_sender_id uuid,
  p_through_message_id uuid,
  p_through_created_at timestamptz,
  p_kind text,
  p_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.send_direct_broadcast(
    jsonb_build_object(
      'conversationId', p_conversation_id::text,
      'messageSenderId', p_message_sender_id::text,
      'throughMessageId', p_through_message_id::text,
      'throughCreatedAt', private.direct_realtime_timestamp(p_through_created_at),
      'kind', p_kind,
      'at', private.direct_realtime_timestamp(p_at)
    ),
    'message-receipt',
    'direct-conversation:' || p_conversation_id::text
  );
exception
  when others then
    raise warning 'direct message receipt broadcast failed (sqlstate %)', sqlstate;
end;
$$;

-- ============================================================== receipts
-- Delivered/read high-watermark of the actor over the PEER's messages: every peer
-- message at or before the target in (created_at, id) order. Timestamps are only
-- ever filled (null -> set), never moved; read implies delivered; a repeated call
-- changes nothing (updated_count 0, no broadcast). Receipts of one conversation are
-- serialized by a lock on its row, so concurrent marks cannot deadlock each other.
create function public.mark_direct_message_receipt(
  p_actor_id uuid,
  p_conversation_id uuid,
  p_through_message_id uuid,
  p_kind text
)
returns table (
  status text,
  conversation_id uuid,
  message_sender_id uuid,
  through_message_id uuid,
  through_created_at timestamptz,
  kind text,
  receipt_at timestamptz,
  updated_count integer
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_peer uuid;
  v_through_created_at timestamptz;
  v_at timestamptz;
  v_count integer;
begin
  if p_actor_id is null or p_conversation_id is null or p_through_message_id is null or
     p_kind is null or p_kind not in ('delivered', 'read') then
    return query select 'invalid_request'::text, null::uuid, null::uuid, null::uuid,
      null::timestamptz, null::text, null::timestamptz, null::integer;
    return;
  end if;

  if not exists (select 1 from public.profiles as actor where actor.id = p_actor_id) then
    return query select 'profile_not_ready'::text, null::uuid, null::uuid, null::uuid,
      null::timestamptz, null::text, null::timestamptz, null::integer;
    return;
  end if;

  select case
      when conversation.participant_low_id = p_actor_id then conversation.participant_high_id
      else conversation.participant_low_id
    end
    into v_peer
  from public.direct_conversations as conversation
  where conversation.id = p_conversation_id
    and p_actor_id in (conversation.participant_low_id, conversation.participant_high_id)
  for no key update;

  if not found then
    return query select 'conversation_not_found'::text, null::uuid, null::uuid, null::uuid,
      null::timestamptz, null::text, null::timestamptz, null::integer;
    return;
  end if;

  -- The target must be a message the PEER sent in this conversation: a missing one,
  -- one of another conversation and the actor's own all share one result.
  select message.created_at
    into v_through_created_at
  from public.direct_messages as message
  where message.id = p_through_message_id
    and message.conversation_id = p_conversation_id
    and message.sender_id = v_peer;

  if not found then
    return query select 'message_not_found'::text, null::uuid, null::uuid, null::uuid,
      null::timestamptz, null::text, null::timestamptz, null::integer;
    return;
  end if;

  v_at := clock_timestamp();

  update public.direct_messages as message
  set delivered_at = coalesce(message.delivered_at, v_at),
      -- greatest(): a delivered_at committed meanwhile by a concurrent mark may be
      -- later than v_at; read never precedes delivered.
      read_at = case
        when p_kind = 'read' then coalesce(message.read_at, greatest(v_at, coalesce(message.delivered_at, v_at)))
        else message.read_at
      end
  where message.conversation_id = p_conversation_id
    and message.sender_id = v_peer
    and (message.created_at, message.id) <= (v_through_created_at, p_through_message_id)
    and case when p_kind = 'read' then message.read_at is null else message.delivered_at is null end;

  get diagnostics v_count = row_count;

  if v_count > 0 then
    perform private.broadcast_direct_message_receipt(
      p_conversation_id, v_peer, p_through_message_id, v_through_created_at, p_kind, v_at
    );
  end if;

  return query select 'ok'::text, p_conversation_id, v_peer, p_through_message_id,
    v_through_created_at, p_kind, case when v_count > 0 then v_at end, v_count;
end;
$$;

revoke execute on function public.mark_direct_message_receipt(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.mark_direct_message_receipt(uuid, uuid, uuid, text) to service_role;

revoke all privileges on function private.direct_realtime_timestamp(timestamptz)
  from public, anon, authenticated;
revoke all privileges on function private.send_direct_broadcast(jsonb, text, text)
  from public, anon, authenticated;
revoke all privileges on function private.broadcast_direct_message_created()
  from public, anon, authenticated;
revoke all privileges on function private.broadcast_direct_message_receipt(uuid, uuid, uuid, timestamptz, text, timestamptz)
  from public, anon, authenticated;

-- The receipt RPC runs as service_role (security invoker) and reaches only this one
-- private function.
grant usage on schema private to service_role;
grant execute on function private.broadcast_direct_message_receipt(uuid, uuid, uuid, timestamptz, text, timestamptz)
  to service_role;

-- ============================================================== Realtime authorization
-- Topics (exact, canonical lowercase UUIDs only):
--   direct-conversation:<conversationId>  server-only hints (message-created, message-receipt)
--   direct-typing:<conversationId>        ephemeral typing, sent by participants
--   direct-inbox:<userId>                 server-only message-created for one user's inbox
-- The actor is always auth.uid() of the joining JWT, never an argument; anything
-- malformed is simply false (the pattern check runs before any cast).
create function private.can_receive_direct_realtime_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_conversation uuid;
begin
  if v_actor is null or p_topic is null then
    return false;
  end if;

  if not exists (select 1 from public.profiles as actor where actor.id = v_actor) then
    return false;
  end if;

  if p_topic = 'direct-inbox:' || v_actor::text then
    return true;
  end if;

  if p_topic !~ '^direct-(conversation|typing):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;

  v_conversation := substr(p_topic, strpos(p_topic, ':') + 1)::uuid;

  return exists (
    select 1
    from public.direct_conversations as conversation
    where conversation.id = v_conversation
      and v_actor in (conversation.participant_low_id, conversation.participant_high_id)
  );
end;
$$;

-- Sending is narrower: only the typing topic of a conversation the actor is part of.
-- Server-only topics (conversation hints, inboxes, post comments) never match here,
-- so a client cannot forge message-created or message-receipt.
create function private.can_send_direct_typing_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_conversation uuid;
begin
  if v_actor is null
    or p_topic is null
    or p_topic !~ '^direct-typing:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    return false;
  end if;

  v_conversation := substr(p_topic, char_length('direct-typing:') + 1)::uuid;

  return exists (
    select 1
    from public.profiles as actor
    cross join public.direct_conversations as conversation
    where actor.id = v_actor
      and conversation.id = v_conversation
      and v_actor in (conversation.participant_low_id, conversation.participant_high_id)
  );
end;
$$;

revoke all privileges on function private.can_receive_direct_realtime_topic(text)
  from public, anon, authenticated;
revoke all privileges on function private.can_send_direct_typing_topic(text)
  from public, anon, authenticated;

-- Only what the policies below need when Realtime evaluates them as `authenticated`
-- (schema usage was already granted for the post-comments policy).
grant usage on schema private to authenticated;
grant execute on function private.can_receive_direct_realtime_topic(text) to authenticated;
grant execute on function private.can_send_direct_typing_topic(text) to authenticated;

-- Additive to the post-comments policy. RLS on realtime.messages is managed by
-- Supabase and is not altered here.
create policy authenticated_receive_direct_message_broadcasts
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and private.can_receive_direct_realtime_topic((select realtime.topic()))
  );

create policy authenticated_send_direct_typing_broadcasts
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and private.can_send_direct_typing_topic((select realtime.topic()))
  );

commit;
