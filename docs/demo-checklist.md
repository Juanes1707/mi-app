# Demo checklist (8–12 minutes)

## Environment prerequisites

- Use a safe dev/test Supabase project with all migrations and Edge Functions deployed.
- Configure only public Mobile values: Supabase URL, publishable key and backend base URL.
- Prepare users A (private), B (requester/follower) and C (outsider), plus static JPEG/PNG/WebP images.
- Use a native Android development/release build. Expo export alone is insufficient.
- If a prerequisite is missing, state **environment prerequisite** and show the tracked code/diagram; do not present it as runtime evidence.

## Script

### 0:00–0:45 — 1. Auth

- Open a cold build and sign in as user B.
- State that Presentation calls auth use cases; only `SupabaseAuthRepository` talks to Supabase Auth.
- Identify the chosen flow as Mobile → Supabase Auth.

### 0:45–1:45 — 2. Feed

- Show Home and the persistent four-tab bar: Home, Explore, Activity, Profile.
- Scroll enough to show pagination and image loading/cancellation.
- Explain Edge-authorized keyset reads and the 32 MiB RAM / 128 MiB disk cache.

### 1:45–2:35 — 3. Post publish

- Open create, choose one static image and publish it.
- Return to Home and show the post.
- Explain client UUID, signed upload, private bucket and idempotent publish.
- Requires Android ImagePicker plus hosted Storage/Edge.

### 2:35–3:20 — 4. Like

- Toggle Like and point out the immediate UI update.
- Briefly disconnect, toggle again and show that state remains optimistic.
- Explain owner-scoped SQLite FIFO and canonical reconciliation.

### 3:20–4:15 — 5. Comments

- Open comments, add a root comment and a nested reply.
- With a second device/session, add a comment and show the Realtime update.
- Explain ID-only private Broadcast followed by canonical HTTP.
- Hosted Realtime is an environment prerequisite.

### 4:15–5:15 — 6. Private Profile / follow request

- As B, find private A in Explore and request follow.
- As A, open Activity and reject one request; repeat and approve.
- Show that a pending request does not expose private content and acceptance creates the `follows` relationship.
- From A's own Profile, open **Seguidores** and **Seguidos**; from B's selected authorized Profile, open both lists and tap a row to reuse the existing Profile screen.
- As outsider C, confirm the private-list affordance is hidden; a manual deep route must show the same **Perfil no disponible.** result used for a missing profile.

### 5:15–5:55 — 7. Share / deep link

- Use Share on one Post and show `instagramclone://post/{uuid}`.
- Open the URI on a warm and cold installed build and verify Post detail/comments.
- Native Android resolution and share sheet are environment prerequisites.

### 5:55–6:45 — 8. Offline recovery

- Disable network, Like and publish a Comment; show optimistic rows.
- Restore network and wait for event-driven FIFO drain/reconciliation.
- Switch accounts only after the queue settles; explain that owner/token checks prevent A work from using B credentials.

### 6:45–8:10 — 9. DMs

- Open B↔A from Profile, send messages, show Inbox reorder and typing.
- With the peer session visible, show Delivered and Visto.
- Explain canonical participant pair, client message ID, exact retry and separate private topics.
- Hosted private Realtime is an environment prerequisite.

### 8:10–9:40 — 10. Stories

- Show the horizontal tray and self tile; publish a static Story.
- Open the first unseen Story, show 5-second progress, left/right tap and long-press pause.
- Background/foreground the app, then show seen-ring persistence.
- Android gesture, `onDisplay`, `content://` and Reanimated runtime are environment prerequisites.

### 9:40–10:30 — 11. Architecture/security summary

- Draw: Presentation → Application → Domain contract → HTTP adapter → Edge → RPC/Storage.
- Name the three exceptions: Auth, Realtime transport, signed Storage data plane.
- Close with privacy-safe 404, RLS/service-role RPC, authorization-before-cache and owner isolation.

## Before final classroom demo on Android

- [ ] Install Android SDK.
- [ ] Select a supported JDK for the Expo-generated Gradle toolchain.
- [ ] Connect an `adb` device or start an emulator.
- [ ] Choose and persist the intended `android.package` before the reproducible native build.
- [ ] Produce and install a native build.
- [ ] Test warm deep link `instagramclone://post/{uuid}`.
- [ ] Test cold deep link `instagramclone://post/{uuid}`.
- [ ] Test the Android Share sheet.
- [ ] Test ImagePicker and signed upload with a real `content://` URI.
- [ ] Test Story long press with `Gesture.Exclusive`.
- [ ] Confirm Story image `onDisplay` starts playback/seen state.
- [ ] Confirm Reanimated progress, pause and resume on device.
- [ ] Test offline Like/Comment and reconnect drain.
- [ ] Test hosted Comments and DM Realtime on two sessions.
- [ ] Record `adb shell dumpsys gfxinfo` during a long Feed scroll.
- [ ] Record `adb shell dumpsys meminfo` before/after long Feed/Stories use.
- [ ] Test keyboard/composer behavior in Comments and DMs.

## Before hosted integration test

- [ ] Create or select a safe dev/test Supabase project.
- [ ] Configure the public Supabase URL and publishable key locally; never commit them.
- [ ] Configure the public backend base URL locally.
- [ ] Apply every tracked migration in order.
- [ ] Deploy all required Edge Functions.
- [ ] Deploy `profile-connections` and apply both follower/following list RPCs.
- [ ] Create test users A, B and C without using real passwords in tracked files.
- [ ] Make A private, B requester/follower and C outsider.
- [ ] Verify A/self, public target and B/current follower can page both lists; pending-only, inverse-follow and C/outsider cannot.
- [ ] Confirm `post-media` and `story-media` buckets are private with expected MIME/size limits.
- [ ] Confirm service-role secrets exist only in server-side project secrets.
- [ ] Enable/configure Realtime private Broadcast authorization.
- [ ] Test Comments receive authorization for self/public/followed and denial for outsiders.
- [ ] Test DM conversation/inbox receive policies and typing-only INSERT.
- [ ] Verify Mobile cannot forge comment-created, message-created, message-receipt or inbox events.
- [ ] Test privacy-safe 404 behavior and signed media revocation.
- [ ] Test client UUID replay and conflict for Posts, Comments, DMs and Stories.

## Evidence to retain

- Build identifier/package, device model/API and JDK/Gradle versions.
- Short screen recording of the ordered demo.
- `gfxinfo` and `meminfo` text captured without credentials.
- Hosted migration/function versions and pass/fail checklist, without URLs, tokens or passwords.
