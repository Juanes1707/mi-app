# Final requirements audit

Audit date: 2026-10-04

Audited baseline: `12391bf8c4e00ade8b40ed6d033e177d8edb18be` (`Finalize project audit and defense guide`)

Academic source: `Parcial Desarrollo Movil - Proyecto 3_ Red Social Estilo Instagram V2.pdf` (3 pages)

Scope: tracked Mobile source, Edge Functions, PostgreSQL migrations, Expo configuration and locally executable checks.

## Evidence rules

- ✅ **VALIDATED REAL**: direct evidence in tracked source/configuration or a command executed successfully in this checkout.
- 🧪 **VALIDATED SIMULATED/LOCAL**: local harness, static contract inspection, generated native configuration, or JavaScript bundle smoke test. This is not evidence from a physical Android device or hosted Supabase.
- ⚠️ **NOT EXECUTABLE IN CURRENT ENVIRONMENT**: the required Android or hosted Supabase resource is absent.
- ❌ **FAIL**: a requirement from the academic source has no complete implementation. It is not converted into a pass by architecture notes.

The `Status` column uses only the allowed values. `PASS` means the tracked implementation/configuration itself was directly verified. `PASS — simulated/local` means behavior was exercised locally or established by an isolated harness. A successful Expo export is only a bundle smoke test.

## Requirements matrix

| Requirement | Status | Implementation / files | Evidence | Validation type | Runtime limitation |
|---|---|---|---|---|---|
| Authenticated application entry | PASS | `src/features/auth/**`, `src/app/_layout.tsx` | Repository/use cases/provider isolate Supabase Auth; unauthenticated users see the auth entry screen. | ✅ Source inspection | Hosted sign-in/sign-up was not exercised. |
| Feed authorized backend read | PASS | `backend-feed-repository.ts`, `AuthenticatedBackendApiClient`, `supabase/functions/feed/index.ts` | Mobile calls the Edge HTTP endpoint with JWT; the Edge Function derives the actor from the verified token. | ✅ Source inspection | Hosted request was not exercised. |
| Feed keyset pagination | PASS | `get-feed-page.ts`, `feed-page-response.ts`, `list_feed_posts` migration | Cursor couples timestamp and UUID; response validation enforces ordering and cursor consistency. | ✅ Contract inspection | Hosted large-feed run was not exercised. |
| No direct Mobile business Supabase reads | PASS | `src/features/**`, `src/app/**` | Global grep found no `supabase.from(` or `supabase.rpc(` in presentation, application or domain; business repositories use HTTP Edge endpoints. | ✅ Global source audit | Auth, Realtime transport and signed Storage data plane remain documented exceptions. |
| Private Post media | PASS | post media bucket/read/upload migrations and Edge Functions | Bucket is private; upload/read capabilities are authorized server-side and delivered as short-lived signed capabilities. | ✅ SQL/Edge inspection | Hosted Storage was not exercised. |
| Persistent bottom navigation: Home, Explore, Activity, Profile | PASS | `src/components/app-tabs.tsx`, `app-tabs.web.tsx` | Exactly four triggers exist; no fifth tab. | ✅ Source inspection | Native interaction was not exercised. |
| Independent navigation stack per main tab | PASS | four `(tabs)/*/_layout.tsx` files | Home, Explore, Activity and Profile each own a nested Stack. | ✅ Route inspection | Native stack preservation was not exercised on Android. |
| Static image Post creation/publication | PASS | `post-create/**`, `post-media-upload`, `posts` Edge Function | ImagePicker → signed upload → idempotent publish with client UUID. | ✅ Source/contract inspection | Android `content://` and hosted upload were not exercised. |
| Dynamic Likes | PASS — simulated/local | optimistic like hook, SQLite queue, `post-likes` Edge Function/RPC | UI projection, durable command and canonical result are implemented; representative local regression and TypeScript passed. | 🧪 Local/static | Hosted mutation was not exercised. |
| Nested Comments | PASS | comment tree, paginated comment repository and SQL RPCs | Root/reply IDs, parent relation, flattened tree and branch pagination are implemented. | ✅ Source/SQL inspection | Hosted nested thread was not exercised. |
| Realtime Comments | PASS — simulated/local | private Broadcast migration/source and targeted `GET /post-comment` | Broadcast carries IDs only; Mobile fetches canonical authorized data and deduplicates. | 🧪 Local/static | Real hosted WebSocket was not exercised. |
| Share Post | PASS | `post-sharing/**`, Feed/Post detail actions | Shares `instagramclone://post/{uuid}` through the platform share API. | ✅ Source inspection | Android share sheet was not exercised. |
| Public Profiles | PASS | profile search/view repositories, screens and Edge functions | Search and profile view models support public profiles. | ✅ Source inspection | Hosted profiles were not exercised. |
| Private Profiles and relationship state | PASS | `get_profile_view`, profile view screen, follow flow | Private flag and relationship (`none`, `request_pending`, `following`) are returned through Edge. | ✅ Source/SQL inspection | Hosted privacy path was not exercised. |
| Followers/following graph | PASS | `follows`, `follow_requests`, follow RPCs | Accepted relationships live in `follows`; pending requests remain separate. | ✅ SQL inspection | No hosted multi-user run. |
| Followers/following list UI and authorized list read | PASS — simulated/local | `profile-connections/**`, two root routes, Edge Function and two list RPCs | 48 Edge + 42 Mobile assertions covered strict contracts, privacy-safe outcomes, pagination, owner mismatch and async races; SQL authorization/grants were inspected. | 🧪 Local harness/static SQL | Hosted multi-user PostgreSQL/Edge and native Android UI were unavailable. |
| Formal private follow request | PASS | follow request use cases/Edge/RPC | Private target creates one pending request; it does not create a `follows` row. | ✅ Source/SQL inspection | Hosted A/B run was not exercised. |
| Approve follow request | PASS | Activity accept action and `respond_follow_request` RPC | Accept transitions the request and inserts the actual follow relation atomically. | ✅ Source/SQL inspection | Hosted A/B run was not exercised. |
| Reject follow request | PASS | Activity reject action and `respond_follow_request` RPC | Reject transitions request state without creating a follow. | ✅ Source/SQL inspection | Hosted A/B run was not exercised. |
| Private access depends on an actual follow | PASS | feed/post/comment/story RPC predicates | Visibility checks query `follows`; pending or historical requests do not grant access. | ✅ SQL inspection | Hosted privacy run was not exercised. |
| Two-level custom image cache | PASS — simulated/local | `LruMemoryImageCache`, `DiskImageCache`, `PostImageLoader` | Local focused regression validated RAM LRU, byte accounting, authorization ordering and dedupe. | 🧪 16/16 focused harness subset | Native memory behavior was not measured. |
| L1 RAM limit 32 MiB | PASS | `POST_MEDIA_MEMORY_BUDGET_BYTES` | One byte-budgeted LRU owns the decoded-image cache. | ✅ Constant/constructor inspection | Native retained memory was not measured. |
| L2 disk limit 128 MiB | PASS | `POST_MEDIA_DISK_BUDGET_BYTES`, `DiskImageCache` | Serialized index, size checks and LRU eviction are implemented. | ✅ Source inspection | Device filesystem pressure was not exercised. |
| Signed URL is not cache identity | PASS | disk key parser and story namespace | Stable `imagePath`/namespaced story key identifies entries; signed URL is used only for the authorized download. | ✅ Source inspection | Hosted signed URL expiry was not exercised. |
| Viewport cancellation | PASS | Feed viewability tracking, Post media hook/loader | Leaving the viewport cancels the consumer; the last consumer aborts the shared download. | ✅ Source inspection | Android scroll behavior was not measured. |
| In-flight image dedupe | PASS — simulated/local | `PostImageLoader.inFlight` | Two concurrent consumers of one key produced one acquisition in the focused harness. | 🧪 Local harness | Native downloader was replaced by a fake. |
| Memory cleanup and decode bounds | PASS | memory pressure binding, decoder purge, 1440 px limit | RAM references are cleared under pressure; Expo internal caches are purged; decoded longest edge is bounded. | ✅ Source inspection | `meminfo` was not available. |
| Posts and Stories share cache infrastructure | PASS | `post-media-container.ts`, `stories-container.ts` | Both use the same RAM LRU, disk LRU, downloader and decoder; Stories use a namespaced key and owner-bound authorizer. | ✅ Construction inspection | Native runtime was not exercised. |
| Expo Image does not add a parallel cache | PASS | Post media component and decoder | Render uses decoded local `ImageRef` with `cachePolicy="none"`; decoder purges internal caches. | ✅ Source inspection | Native library internals were not profiled. |
| Long Feed readiness | PASS | Feed `FlatList`, keyset page loading, viewability control | Virtualization and bounded image work are present. | ✅ Source inspection | Long continuous device scroll was not exercised. |
| 60 FPS long Feed | BLOCKED — environment | Architecture is prepared but no metric exists | No Android SDK, ADB, emulator or physical device; no `gfxinfo` trace. | ⚠️ Not executable | 60 FPS must not be claimed. |
| Optimistic Like update | PASS | `use-optimistic-post-likes.ts` | Visible state changes immediately and overlays canonical feed state. | ✅ Source inspection | Gesture latency was not measured. |
| Durable Like projection/queue | PASS | SQLite offline schema/queue | Owner, post and desired state are stored durably. | ✅ Source/SQL inspection | Device process-death scenario was not exercised. |
| FIFO Like replay after reconnect | PASS — simulated/local | processor/coordinator/orchestrator | A single serial drain peeks the smallest sequence and triggers on connectivity/foreground events; transient failures are retried with capped exponential backoff while the app is in use and online. | 🧪 `offline-sync-queue.test.mjs` (real SQLite file) | Real radio reconnect was not exercised. |
| Background queue processing | PASS — simulated/local | `offline-sync-background.ts`, `expo-offline-sync-background-task.ts`, `index.ts` | While signed in, an `expo-background-task` task drains through the same orchestrator with the app in background; it is defined before Expo Router so a headless OS start finds it. | 🧪 Local harness (task body) + Android Hermes export | Expo Go reports background tasks as restricted; OS scheduling needs a development build. |
| Like canonical reconciliation | PASS | resolution signal and optimistic overlay | Terminal server result removes the queue row and reconciles visible state. | ✅ Source inspection | Hosted canonical response was not exercised. |
| Optimistic Comment with client UUID | PASS | comment composer/use cases/overlay | UUID exists before enqueue and is reused by the remote command. | ✅ Source inspection | Native interaction was not exercised. |
| Durable Comment queue and retry | PASS | SQLite queue, processor, comment gateway | Comment body/parent/client ID persist; retry replays the same ID. | ✅ Source inspection | Process death/restart was not exercised. |
| Comment terminal outcomes and reconciliation | PASS — simulated/local | mutation resolution types/signals | Success, idempotent replay, not-found, contractual rejection and UUID conflict are terminal; only transient failures block the queue. | 🧪 `offline-sync-queue.test.mjs` | Hosted conflict path was not exercised. |
| Offline queue owner scope | PASS | every SQLite query plus owner-bound gateways | Rows are queried/deleted by owner; `getAsUser`/`postAsUser` verifies JWT subject before sending. | ✅ Source inspection | A/B device session run was not exercised. |
| 1:1 direct conversations | PASS | DM routes, repository, Edge Functions, SQL | Inbox, conversation history and send flows are present. | ✅ Source/SQL inspection | Hosted chat was not exercised. |
| Canonical participant pair A/B == B/A | PASS | direct conversation SQL constraints/RPC | Participants are ordered and unique; either direction resolves the same row. | ✅ SQL inspection | Hosted concurrent creation was not exercised. |
| DM client-generated message ID and exact retry | PASS | send use case/Edge/RPC | Repeating the same ID and payload returns the canonical message; different payload is a conflict. | ✅ Source/SQL inspection | Hosted retry was not exercised. |
| DM participant authorization and outsider-safe missing | PASS | DM RPCs and Edge mapping | Actor must be a participant; unauthorized access maps to privacy-safe missing. | ✅ SQL/Edge inspection | Hosted outsider run was not exercised. |
| DM private conversation topic | PASS | Realtime source and SQL trigger | `direct-conversation:<id>` is private and server events carry minimal IDs/order metadata. | ✅ Source/SQL inspection | Hosted WebSocket was not exercised. |
| DM typing topic is the only client-writable topic | PASS | Realtime RLS policies/source | Only `direct-typing:<id>` INSERT is allowed for a participant. | ✅ SQL/source inspection | Hosted policy was not exercised. |
| DM inbox topic is server-only | PASS | `direct-inbox:<user>` policy/trigger | Clients receive reorder hints; client INSERT is not granted. | ✅ SQL inspection | Hosted WebSocket was not exercised. |
| Delivered / Read semantics | PASS | receipt RPC/coordinator/overlay | Read advances delivered too; receipt state is monotonic. | ✅ Source/SQL inspection | Hosted receipts were not exercised. |
| Receipt high-watermark and idempotence | PASS — simulated/local | receipt RPC and coordinator | Focused regression confirmed coalescing and read covering older delivered; SQL updates messages at/before the target. | 🧪 Local harness/static SQL | Hosted concurrent receipts were not exercised. |
| Inbox realtime reorder | PASS | inbox signal/source/hook | Authorized inbox hint triggers canonical HTTP refresh and stable reorder. | ✅ Source inspection | Hosted WebSocket was not exercised. |
| Hosted DM/Comments Realtime | BLOCKED — environment | Supabase private Broadcast design exists | No hosted project URL/key, deployed migrations/functions or WebSocket session. | ⚠️ Not executable | Cannot claim real WebSockets. |
| Required routes exist | PASS | `src/app/post`, `messages`, `stories` | `/post/[postId]`, `/post/[postId]/comments`, `/messages`, `/messages/[conversationId]`, `/stories/[authorId]`. | ✅ Route inventory | Installed-device routing was not exercised. |
| Schemes `miapp` and `instagramclone` tracked | PASS | `app.json` | Both schemes are in the tracked Expo configuration. | ✅ Config inspection | None for source configuration. |
| Android generated manifest includes both schemes | PASS — simulated/local | Implementation 53 temporary prebuild evidence | Local generated configuration contained both schemes and the Android Hermes export completed. | 🧪 Prior local generation | Generated `android/` is intentionally untracked. |
| Installed Android deep-link resolution | BLOCKED — environment | `/post/[postId]` route and scheme exist | No installed APK/device was available for warm/cold intent tests. | ⚠️ Not executable | Must test both warm and cold starts. |
| Private `story-media` bucket | PASS | Stories migration | Bucket is non-public, has MIME/size constraints and no permanent authenticated business policy. | ✅ SQL inspection | Hosted Storage was not exercised. |
| Story signed upload and path binding | PASS | Story Edge functions/shared capability validator | Client UUID is checked; server path binds actor/story/extension; object metadata is verified before publish. | ✅ Source/SQL inspection | Hosted upload was not exercised. |
| Story publish idempotence | PASS | publish RPC/Edge | Exact replay returns the same Story; mismatched path is a conflict. | ✅ Source/SQL inspection | Hosted retry was not exercised. |
| Story exact 24 h expiry | PASS | Stories SQL and response validation | Active predicate is `created_at > current_timestamp - interval '24 hours'`; exactly 24 h is excluded. | ✅ SQL/source inspection | Server clock behavior was not exercised hosted. |
| Story tray self + followed | PASS | `list_story_trays`, tray Edge/repository | Self and accepted follows are returned; pending requests do not grant a tray. | ✅ SQL inspection | Hosted A/B run was not exercised. |
| Story visibility self/public/followed | PASS | active Stories/media RPCs | Private Stories require self or an actual accepted follow. | ✅ SQL inspection | Hosted privacy run was not exercised. |
| Story authorized signed read | PASS | story media Edge/repository/authorizer | Every acquisition asks Edge for authorized media before RAM/disk lookup. | ✅ Source inspection | Hosted signed read was not exercised. |
| Home horizontal Stories tray and synthetic self tile | PASS | Feed screen, tray components/items | Tray renders independently of Feed load/error; self add tile exists even without active Stories. | ✅ Source inspection | Native visual interaction was not exercised. |
| Static Story publication with ImagePicker | PASS | publication controller/selector/uploader | Validated static JPEG/PNG/WebP image follows prepare/upload/publish. | ✅ Source inspection | Android `content://` was not exercised. |
| Fullscreen viewer, first unseen and cross-author navigation | PASS | viewer controller/screen | First unseen selection, author order and next/previous transitions are implemented. | ✅ Source inspection | Native gestures were not exercised. |
| 5 s autoplay and progress | PASS — simulated/local | playback controller/Reanimated hook | Focused harness verified 5 s and remaining-time resume; Reanimated drives progress without a JS interval. | 🧪 Local controller harness | Reanimated UI runtime was not exercised. |
| Tap navigation and long-press pause | PASS — simulated/local | gesture hook/press arbiter | Harness verified left/right taps and hold suppressing tap; production uses `Gesture.Exclusive`. | 🧪 Local controller harness | Real Android gesture recognition was not exercised. |
| AppState/focus pause | PASS | Story playback hook | Blur/background pauses; foreground revalidates before resume. | ✅ Source inspection | Android lifecycle was not exercised. |
| Local owner-scoped Story seen | PASS | separate Stories SQLite database/tracker | Rows and completion snapshots are owner-scoped and expire locally for housekeeping. | ✅ Source/SQLite inspection | Device persistence was not exercised. |
| Seen rings without downloading all Stories | PASS — simulated/local | tray snapshot rule | Harness confirmed newest timestamp + active count rule. | 🧪 Local harness | Hosted tray values were not exercised. |
| Bounded Story prefetch and cancellation | PASS | viewer controller | Only the next image lease is prefetched; replacement/dispose cancels leases. | ✅ Source inspection | Native network cancellation was not exercised. |
| Android Story `Gesture.Exclusive`, `onDisplay`, Reanimated and `content://` | BLOCKED — environment | Production code paths exist | No Android device/emulator. | ⚠️ Not executable | Must be validated on final device. |
| Presentation/Application/Domain Supabase boundary | PASS | global grep and layer review | Business table/RPC access is absent; use cases know interfaces/entities, not Supabase. | ✅ Global source audit | None for source boundary. |
| Auth direct Supabase exception is isolated | PASS | `SupabaseAuthRepository`, token provider, Supabase client | Current design is **Mobile → Supabase Auth**; presentation/application only see `AuthRepository`/token port. | ✅ Source inspection | This does not introduce a backend auth proxy. |
| Realtime transport exception is isolated | PASS | two Supabase Realtime sources | Supabase channel use exists only in Data and exposes domain events. | ✅ Source inspection | Hosted channel join was not exercised. |
| Signed Storage data plane exception is isolated | PASS | shared signed uploader/download path | Mobile transfers bytes only with a backend-issued signed capability; it does not query business tables. | ✅ Source inspection | Hosted Storage was not exercised. |
| SQL RLS and service-role-only business access | PASS | all social migrations | Tables enable RLS, public/anon/authenticated privileges are revoked, expected RPCs are service-role only. | ✅ SQL audit | Migrations were not applied to hosted PostgreSQL here. |
| SECURITY DEFINER discipline | PASS | profile bootstrap and Realtime helpers/triggers | DEFINER functions are limited to bootstrap/broadcast authorization, use fixed empty `search_path`, and have restricted EXECUTE. | ✅ SQL audit | Hosted catalog grants were not queried. |
| Realtime event anti-forgery | PASS | Realtime policies | Mobile can insert only authorized typing Broadcast; comment/message/receipt/inbox events remain server-emitted. | ✅ SQL audit | Hosted adversarial test was not executed. |
| Cache authorization before private bytes | PASS — simulated/local | Post/Story authorizers and loader | Harness observed authorization before a RAM hit; revoked access purged RAM, disk and decoder cache. | 🧪 Local harness | Hosted revocation race was not exercised. |
| Account switch isolation | PASS — simulated/local | owner-bound background transports, hook generations, keyed authenticated Stack | This audit added `key={user.id}` so all route state/requests unmount on A→B; local guard plus TypeScript passed. | 🧪 Local/static regression | Full two-account Android run was not possible. |
| Network/HTTP/response failure mapping | PASS | backend client and feature errors | Timeout/network/invalid JSON and 401/404/409/500 are mapped into feature/domain outcomes; parsers reject malformed shapes. | ✅ Source inspection | Hosted failure injection was not run. |
| SQLite/Storage/Realtime/image failure handling | PASS | queue/tracker/uploader/realtime hooks/loader | SQLite degrades or blocks safely, Storage reports domain errors, Realtime degrades to canonical HTTP, cancellation discards partial files. | ✅ Source inspection | Native failure injection was not run. |
| Expo application configuration | PASS | `app.json`, `package.json` | `expo-router`, `expo-image-picker`, `expo-splash-screen` and `expo-sqlite` plugins are tracked; Router is the entry point; `typedRoutes` and React Compiler are enabled. | ✅ Config inspection | Native generation/runtime remains separately qualified. |
| Android package identifier persisted | BLOCKED — environment | `app.json` has no `android.package` | No tracked project metadata proves `com.juanes1706.miapp` is the intended permanent identity. | ⚠️ Decision blocked | Android package identifier must be chosen/persisted before final native release build. |
| Supported Android JDK/SDK native build | BLOCKED — environment | Expo config/prebuild path exists | Environment has Java 25 but no Android SDK/ADB; Gradle compatibility was not established. | ⚠️ Not executable | Use an Expo-supported JDK/Gradle combination and build natively. |
| TypeScript | PASS | entire tracked TypeScript project | `npx tsc --noEmit` exited 0 after the profile-connections implementation and typed-route generation. | ✅ Executed command | None. |
| Repository hygiene | PASS | tracked/working tree audit | No generated `android/`, exports, APK/AAB, logs, env secrets or scratch harness are tracked. | ✅ Git inspection | `.expo/` and dependencies remain ignored local files. |

## Matrix totals

| Status | Count |
|---|---:|
| PASS | 67 |
| PASS — simulated/local | 15 |
| BLOCKED — environment | 6 |
| FAIL | 0 |

## Confirmed defects corrected across the final audits

### Authorized follower/following lists were absent

- **Gap:** the accepted social graph existed, but there was no authorized page read, Edge endpoint, Mobile repository or navigable list.
- **Fix:** two service-role RPCs authorize the target and keyset-page one joined profile summary page; one JWT-authenticated Edge request invokes one RPC; an owner-bound Mobile feature exposes `/followers/[userId]` and `/following/[userId]` through both Profile screens.
- **Tests:** 48 Edge and 42 Mobile assertions passed. SQL structure/grants passed 17 static assertions. A real PostgreSQL execution and native Android interaction remain blocked by the environment.

### Authenticated route state survived an account change

- **Reproduction:** render the authenticated navigation tree for account A, load Feed/Profile state, then let the auth observer replace A with B without terminating the process. `AuthenticatedContent` kept the same unkeyed `Stack`, so route components and requests could survive the identity change until their own effects happened to reset.
- **Cause:** the authenticated navigation subtree had no owner identity boundary.
- **Fix:** `src/app/_layout.tsx` now keys the Stack with `user.id`. React therefore unmounts the complete route subtree for A and mounts a fresh subtree for B. Long-lived hosts outside the Stack already bind work to the owner and reject mismatched tokens.
- **Tests:** TypeScript passed; a focused local regression asserted the exact owner key. Existing hook generation/unmount checks and `getAsUser`/`postAsUser` guards were re-audited. No new dependency or feature was added.

## Architecture boundary result

```text
Presentation
    ↓ application use cases/controllers
Domain repository interfaces and entities
    ↓ concrete data adapters
Authenticated Edge HTTP API
    ↓ service-role RPC / private Storage capability
PostgreSQL + Supabase Storage
```

The deliberate exceptions are:

1. **Auth:** Mobile → Supabase Auth through `AuthRepository`. Presentation does not import the Supabase client.
2. **Realtime transport:** Data-layer private channel sources join Supabase Realtime; payloads are hints and canonical business data is fetched through Edge HTTP.
3. **Signed Storage data plane:** Mobile uploads/downloads bytes through short-lived server-authorized capabilities.

No use case imports `@supabase/supabase-js`. No new `supabase.` access appears in routes, screens, components, hooks, providers, application or domain.

## Security summary

The actor identity comes from a JWT verified by Edge; actor UUIDs supplied by the client are treated only as expected-owner guards and never as backend authority. Business reads/writes cross the Edge boundary. SQL operations use fixed `search_path`, intentional INVOKER/DEFINER modes and service-role grants. RLS remains enabled and direct anon/authenticated business privileges are revoked. `post-media` and `story-media` are private; Edge authorizes the object path, MIME, size and actor, then issues a short-lived capability. Realtime channel access is protected by RLS and server-only event types cannot be inserted by Mobile. Privacy-safe missing results reduce enumeration. Owner-scoped SQLite, token-subject checks, asynchronous generation guards and the newly keyed authenticated navigation tree isolate account A from B.

## Performance summary

The Feed uses `FlatList` virtualization and keyset paging. Private images use one custom L1/L2 cache: 32 MiB decoded RAM LRU plus 128 MiB encoded disk LRU. Downloads are deduplicated, viewport consumers cancel work, decode size is bounded to 1440 px, only the next Story is prefetched, and memory-pressure handling clears managed/native image caches. Story progress uses Reanimated UI work rather than a JS interval. These design properties and controller/cache behavior are validated locally. Android 60 FPS, `gfxinfo` frame data and `meminfo` remain blocked by the missing device/toolchain.

## Offline summary

Likes and Comments update optimistic projections immediately, persist commands in one owner-scoped SQLite queue, replay strictly by global sequence, and reconcile only after a terminal canonical outcome. Transient failures are retried with capped exponential backoff while the app is in use; commands the backend authoritatively refuses become terminal instead of blocking the queue; an `expo-background-task` task drains the same queue in background (development build). Owner JWT mismatch stops the drain before A can be sent as B. Exact retries are idempotent. DMs deliberately do not use the offline mutation queue. Story seen state uses a separate owner-scoped SQLite database and is a local UX fact.

## Realtime summary

Comments use private Broadcast hints followed by targeted canonical `GET /post-comment`. DMs separate conversation, inbox and typing topics; message/receipt/inbox hints lead to canonical HTTP while typing remains ephemeral. Receipt handling is monotonic and high-watermark based. The design was audited, but no hosted Supabase WebSocket was available, so hosted Realtime remains blocked.

## Stories summary

Stories use private media, backend visibility, exact timestamp-based 24-hour expiry, signed upload/read capabilities, a self-plus-followed Home tray, static image publication, a fullscreen first-unseen viewer, 5-second Reanimated progress, tap/long-press control, foreground revalidation, owner-scoped local seen state and the shared bounded image cache. Real Android `Gesture.Exclusive`, ImagePicker `content://`, image `onDisplay` and Reanimated runtime evidence remain blocked.

## Validation record

- ✅ `npx tsc --noEmit`: passed after the follower/following implementation.
- 🧪 Profile connections Edge harness: **48/48** assertions (strict query, followers/following direction, empty/pagination, 401/404/409/500, malformed rows, order/cursor, one RPC and zero RPC before rejected requests).
- 🧪 Profile connections Mobile harness: **42/42** assertions (strict response parsing, owner A/token B with zero HTTP, loading/error/retry/refresh/pagination, duplicate load guard, late owner/target response and unmount safety, routes/Profile integration).
- 🧪 Expo Router typed routes regenerated with `CI=1 npx expo start --offline`; Metro was stopped and port 8081 was free afterward.
- ⚠️ A temporary real PostgreSQL run was not executable: this environment has no `psql`, PostgreSQL server, Docker or Supabase CLI. SQL privacy, direction, keyset, grants and RLS boundaries were inspected statically without claiming a database execution.
- 🧪 `npx expo export --platform android --output-dir <system-temp>`: passed in this audit (2,020 modules, Hermes `.hbc` bundle). This is not an APK or native Gradle build.
- 🧪 Focused local regression: **16/16** (RAM LRU, private cache authorization, dedupe, revoke purge, Story timing/pause/stale completion/gestures/ring, DM receipt coalescing/read implication, authenticated Stack key, production mock isolation).
- 🧪 Implementation 53: Expo Android prebuild and Hermes export completed; both schemes appeared in generated Android configuration. This is not an APK or device run.
- ⚠️ The historical `h36` source/result is not tracked in this checkout, so the prompt's historical `163/163` baseline was not represented as a current run.
- ⚠️ `h40` remains a non-authoritative stale historical harness and was not used to change production.
- ⚠️ Physical Android, native Gradle build, hosted Supabase, real WebSockets, `gfxinfo` and `meminfo` were unavailable.
- 🧪 Offline queue follow-up: `scripts/functional-checks/offline-sync-queue.test.mjs` **9/9** over a real SQLite file (restart durability, strict FIFO across kinds, backoff after a failed reconnection, no timers offline/background, lost-response idempotency, terminal not-found/rejected/conflict without blocking, corrupt row stop, owner isolation, background task drain); 10/10 targeted mutations detected; `npx tsc --noEmit` and Android Hermes export passed.

## Final assessment

All requirements in the academic matrix now have an implementation. The authorized followers/following list closes the only confirmed functional gap with privacy-safe SQL, a one-RPC Edge boundary, owner-bound Mobile access and navigable list UI. The final result is **CODE COMPLETE — RUNTIME VALIDATION PARTIALLY BLOCKED** because Android and hosted Supabase prerequisites remain absent.
