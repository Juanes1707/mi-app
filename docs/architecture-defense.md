# Architecture defense

## System boundary

```text
React Native / Expo
  Presentation (routes, screens, hooks, providers)
      ↓
  Application (use cases, controllers, orchestration)
      ↓
  Domain (entities, errors, repository contracts)
      ↓
  Data / Infrastructure (HTTP adapters, SQLite, cache, transport)
      ↓
Supabase Edge Functions
      ↓ verified JWT actor + service-role RPC
PostgreSQL / private Storage / Realtime Broadcast
```

Presentation knows application operations and domain-shaped state. Application does not know Supabase. Domain contains contracts and values. Concrete adapters live below those contracts.

## Edge boundary and PostgreSQL RPC

Business data crosses `AuthenticatedBackendApiClient` to Edge Functions. Edge verifies the bearer JWT, derives the actor from the verified subject, validates the request and invokes a narrow PostgreSQL RPC. The actor is not trusted from a body/query parameter. RPCs use fixed `search_path`, intentional security mode and service-role-only execution. Privacy-safe missing responses avoid revealing whether a protected resource exists.

Keyset pagination uses a stable order tuple such as `(created_at, id)`. It avoids the shifting/scan behavior of `OFFSET` and gives deterministic next-page cursors when timestamps tie.

## Three deliberate Supabase exceptions

### Auth

The chosen model is **Mobile → Supabase Auth**. Only `SupabaseAuthRepository` and the access-token provider know the SDK. Screens/providers call auth use cases. The publishable key is a public client identifier; no service-role key belongs in Expo.

### Signed Storage data plane

Edge authorizes the operation and object path, then issues a short-lived signed upload/read capability. Mobile transfers bytes directly to Storage using that capability. The capability does not grant database access and is not a cache identity.

### Realtime transport

Data-layer sources use private Broadcast channels. A Broadcast is a minimal invalidation hint, not the canonical business record. Comments and DMs fetch the canonical row through authorized Edge HTTP before mutating UI state. Only the typing topic permits a client INSERT.

## Offline queue

Likes and Comments share one durable SQLite queue ordered by an autoincrement sequence. Every statement is owner-scoped and parameterized. One serial processor peeks the oldest row, sends one mutation, removes it only after a terminal result, then continues. A transient failure blocks later rows so replies cannot overtake their parents. Before each send, the gateway checks that the token subject still matches the queue owner.

DMs do not use this queue. Story seen has a separate SQLite database because it is a local UX fact rather than a server mutation.

## Image cache

```text
authorize current acquisition
  ↓
L1 decoded RAM LRU (32 MiB)
  ↓ miss
L2 encoded disk LRU (128 MiB)
  ↓ miss
signed download → validated final file → bounded decode (1440 px)
```

Posts and Stories share the same memory/disk/downloader/decoder instances. Story keys add a bucket namespace. Each acquisition authorizes before consulting either cache level, so cached bytes never become permission. One in-flight job per key serves multiple consumers; the last cancellation aborts the download and partial files are discarded. `expo-image` rendering uses `cachePolicy="none"` to avoid a second uncontrolled cache.

## Navigation and owner isolation

The persistent tab bar has Home, Explore, Activity and Profile. Each tab owns a nested Stack. Global routes handle Post deep links, comments, DMs and Stories. `app.json` tracks `miapp` and `instagramclone` schemes.

The authenticated Stack is keyed by `user.id`. Account A's entire route subtree therefore unmounts before account B receives fresh screens. Long-lived background hosts stay outside that Stack because they need to observe auth/connectivity globally; they bind every operation to an owner and reject mismatched token subjects. Feature hooks also use mounted flags, generations and exact route/owner keys to ignore late callbacks.

## Followers and following lists

The read model reuses `public.follows.created_at`. `list_profile_followers` joins rows where the member is `follower_id`; `list_profile_following` joins rows where the member is `followed_id`. Both page by `(created_at DESC, counterpart UUID DESC)`, so a timestamp tie is deterministic and no `OFFSET` is needed.

Before returning members, each RPC allows the target only when it is self, public, or currently followed by the JWT actor. Pending, rejected or historical requests and inverse follows do not grant access. A hidden private target and a missing target both become `profile_not_found`. Once the list itself is authorized, one JOIN returns minimal member summaries in one RPC; it does not perform per-row authorization or HTTP requests.

Mobile keeps the path `Screen → hook/controller → use case → repository → AuthenticatedBackendApiClient → Edge → RPC`. The repository uses `getAsUser`, validates exact keys/order/cursor and rejects an owner/token mismatch before HTTP. Route/owner identity and controller generations discard late pages after refresh, target change, account change or unmount.

## Stories

The backend owns activity and visibility. A Story is active while `created_at > current_timestamp - interval '24 hours'`; exactly 24 hours is expired. The client does not mutate an `expired` flag.

The Home tray returns self plus accepted follows with newest timestamp and active count. The viewer loads first unseen, author pages and one bounded next-image prefetch. A Story becomes locally seen only when its image reports displayed. Completion snapshots let Home decide ring state from tray metadata without downloading every Story. Reanimated performs visual timing on UI work; JavaScript controls readiness, pause reasons and navigation.

## Thread and execution model

- **JavaScript thread:** React state, hooks, controllers, response parsing, queue orchestration and network callbacks.
- **UI/native rendering:** React Native commits/layout and platform drawing.
- **Reanimated UI worklet:** Story progress interpolation. Completion schedules one callback back to React Native JavaScript.
- **Native image work/memory:** HTTP/file operations and `expo-image` decode/render; decoded bitmap memory can be outside the JS heap.
- **SQLite/native module:** database operations execute through Expo SQLite; JavaScript awaits promises and additionally serializes mutation ordering.
- **WebSocket/native/network stack:** connection and I/O are outside JavaScript; domain event handling returns to JavaScript.

The correct defense is not “everything runs in one thread.” JavaScript coordinates multiple native facilities and must still guard asynchronous completions.

## Failure model

- Network/timeout becomes a typed backend error; UI keeps recoverable state and exposes retry where appropriate.
- 401 becomes authentication-required or stops owner-bound work.
- Protected 404 is privacy-safe and may purge cached private media.
- 409 identifies idempotency conflict instead of silently duplicating data.
- 500/unavailable retains queued mutations for a later event-driven retry.
- Malformed JSON or DTO shapes become invalid-response; unchecked backend objects never enter state.
- SQLite failure blocks durable mutation processing; Story seen falls back to memory for the session.
- Storage failure leaves publication unpublished and retryable.
- Realtime disconnect does not corrupt canonical state; later load/focus/HTTP reconciliation remains authoritative.
- Image cancellation aborts the shared job when the last consumer leaves and removes `.part` files.
- Unmount/account switch invalidates generations; the authenticated Stack owner key removes all route state.

## Known delivery limitations

- `android.package` is not persisted because no source proves the permanent native identity. It must be chosen before a reproducible release build.
- Android native behavior, frame/memory metrics and hosted Supabase/WebSocket integration still need their external environments.
