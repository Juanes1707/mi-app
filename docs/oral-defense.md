# Oral defense guide

Answers are intentionally short enough to deliver orally, but each points to a concrete project mechanism. The academic evaluation chooses five questions at random, so every team member should be able to expand any answer with the named files and flow.

## Architecture

### 1. ¿Por qué Mobile no usa supabase.from para business data?

Because business authorization belongs at the Edge boundary. Mobile calls `AuthenticatedBackendApiClient`; Edge verifies the JWT and invokes narrow RPCs with service-role access. This prevents table shape, privileged credentials and authorization decisions from leaking into presentation/application/domain.

### 2. ¿Por qué Auth sí puede acceder directamente a Supabase?

Auth is an explicit infrastructure exception: **Mobile → Supabase Auth**. The SDK is isolated in `SupabaseAuthRepository` and the token provider behind `AuthRepository`/`AccessTokenProvider`; screens and use cases do not import it. The device contains only public client configuration, never `service_role`.

### 3. ¿Cómo evita el proyecto que una respuesta tardía de la cuenta A modifique la cuenta B?

The authenticated Stack is keyed by `user.id`, so switching A→B unmounts all A route state. Surviving background hosts bind operations to an expected owner and compare the JWT subject; hooks use generations, mounted flags and exact route/owner IDs. A late A callback therefore has no current target in B.

### 4. ¿Qué responsabilidad tiene una Edge Function en este proyecto?

It verifies the JWT, derives the actor, validates a narrow request, calls one RPC or issues a signed Storage capability, and maps errors to a privacy-safe HTTP contract. It does not trust an actor ID supplied by Mobile.

### 5. ¿Por qué el dominio define repositorios como interfaces?

Use cases depend on project contracts such as Feed, Stories or DM repositories. HTTP, SQLite, Supabase Auth and Realtime are replaceable infrastructure details, and domain code remains free of SDK types.

### 6. ¿Qué diferencia hay entre autenticación y autorización?

Authentication proves who the JWT subject is. Authorization decides whether that actor may read a private post, join a DM topic or see a Story. Edge and SQL perform authorization even after authentication succeeds.

### 7. ¿Por qué usamos keyset y no OFFSET?

Feed, comments, DMs and Stories page with stable timestamp+UUID tuples. Keyset avoids scanning/skipping large offsets and avoids duplicates or gaps when new rows arrive before a later page.

## Concurrency and state

### 8. ¿Por qué los Likes usan optimistic update?

The like overlay changes the visible boolean/count immediately, so perceived latency is zero. The durable command later reconciles with the canonical Edge result; a terminal failure removes or corrects the overlay instead of pretending success forever.

### 9. ¿Qué pasa si el Like se hace sin conexión?

The desired state and owner are inserted into the SQLite mutation queue. The optimistic projection remains visible. Connectivity/foreground events trigger a FIFO drain; `putAsUser` verifies the current JWT still belongs to that owner before sending. If the first attempt after reconnecting fails, `OfflineSyncCoordinator` retries with exponential backoff (2 s to 60 s) while the app is in use and online. With the app in background, the `expo-background-task` task (WorkManager on Android) runs the same drain when the OS allows it.

### 10. ¿Por qué la offline queue es FIFO?

One autoincrement sequence covers Likes and Comments. Processing oldest-first preserves user intent and prevents a reply from overtaking the comment it references. A transient head failure blocks later commands rather than silently reordering history. A command the backend will never accept (not found, contractual 400, UUID conflict) finishes with that terminal outcome, so one refused command cannot block later actions; the backend rules already kept the remote data intact.

### 11. ¿Por qué un Comment tiene UUID antes de enviarse?

The UUID identifies the optimistic row, durable queue entry and backend command. Retrying the same command uses the same ID, so the RPC can return the existing exact comment or report a payload conflict instead of duplicating it.

### 12. ¿Qué ocurre si se pierde un evento Realtime?

Realtime is an acceleration path, not canonical storage. Page loads, focus/reconnect and targeted HTTP fetches reconcile state. Events carry IDs, and dedupe prevents a later fetch from inserting duplicates.

### 13. ¿Por qué Realtime Comments transporta IDs y no el Comment completo?

Broadcast is treated as untrusted notification. After receiving post/comment IDs, Mobile performs authorized `GET /post-comment`, validates the exact response shape and only then merges the canonical row.

### 14. ¿Cómo se evita que dos disparadores de sincronización drenen la cola en paralelo?

`OfflineMutationProcessor` stores one `activeDrain` promise. Concurrent foreground/connectivity/retry/background-task triggers share it, while SQLite access also goes through a serial executor. The orchestrator collapses triggers that arrive during a run into one trailing drain, and the coordinator keeps at most one backoff timer.

### 15. ¿Cómo preserva el chat un borrador editado durante un send?

The send captures the submitted text/message ID. Completion clears the composer only if the current draft still equals that captured submission; text typed while the request is in flight is retained.

### 16. ¿Por qué DM A/B y B/A producen la misma conversación?

SQL canonicalizes the participant pair into low/high UUID columns, enforces low < high and has a unique pair constraint. Both directions resolve the same key.

### 17. ¿Cómo evita el retry duplicar un DM?

Mobile creates `messageId`. The send RPC treats the same conversation/sender/body replay as success and a different payload under the same ID as conflict. The client never generates a fresh ID for an automatic retry.

### 18. ¿Por qué typing está en un topic distinto?

Typing is ephemeral and client-writable, while messages and receipts must be server-authored and canonical. Separate topics let Realtime RLS permit INSERT only on `direct-typing:<conversation>` without opening the conversation topic to forgery.

### 19. ¿Cómo impedimos que el cliente falsifique Visto?

Mobile cannot INSERT message-receipt Broadcast events. It calls an authenticated Edge endpoint; the receipt RPC verifies participant and peer-message target, updates the high-watermark, and the database trigger emits the server event.

### 20. ¿Qué significa high-watermark en receipts?

A receipt stores the newest peer message known delivered/read. Every peer message at or before that `(created_at,id)` position is covered, so the system sends monotonic progress instead of one receipt per message.

### 21. ¿Por qué read implica delivered?

Reading a message logically proves it reached the recipient. Both SQL and the coordinator advance delivered when read advances; a later older delivered request becomes redundant.

## Threads and performance

### 22. ¿Qué corre en JS thread y qué puede ejecutarse fuera?

React state, controllers, parsing and async callbacks run on JavaScript. React Native rendering, network/file I/O, SQLite/native module work and image decode use native facilities. Story progress runs as a Reanimated UI worklet and schedules only completion back to JavaScript.

### 23. ¿Por qué autoplay usa Reanimated?

The progress interpolation runs with `withTiming` on UI work instead of a JS interval. JavaScript owns readiness/pause/navigation, reducing per-frame JS work during Stories.

### 24. ¿Qué ocurre si la app va a background durante una Story?

`AppState` adds a background pause reason and preserves the elapsed fraction. On foreground the viewer revalidates the active Story first; only a still-valid Story resumes for its remaining time.

### 25. ¿Qué ocurre cuando una celda sale del viewport?

Feed visibility removes its image consumer and clears the cell-held image. If no other consumer needs the key, `PostImageLoader` aborts the download and discards the partial file.

### 26. ¿Cómo mantiene el Feed preparado un scroll largo?

It uses `FlatList`, keyset pages, viewport-controlled image work, one in-flight job per media key, bounded decode and byte budgets. The design is audited; 60 FPS still requires Android `gfxinfo` measurement.

### 27. ¿Por qué una respuesta de red no debe asumir el mismo hilo que la UI?

Promises resume on the JS event loop after native network work. By then a route may be unmounted, its parameter may change or another account may be active, so hooks validate mounted/generation/owner before calling `setState`.

### 28. ¿Qué trabajo hace SQLite y cómo se ordena?

Expo SQLite performs native database operations exposed as promises. A JavaScript `SerialExecutor` additionally orders every queue read/write, so a read observes earlier enqueues and only one mutation replay is active.

## Memory and cache

### 29. ¿Por qué la cache usa imagePath y no signed URL?

`imagePath` is the stable media identity. Signed URLs rotate and include credentials/expiry; using them as keys would duplicate the same bytes and could persist capability material in the index.

### 30. ¿Por qué hay L1 y L2?

L1 keeps decoded images for fast rendering but is expensive, so it is limited to 32 MiB. L2 keeps encoded files across renders at 128 MiB. Both use LRU and one miss proceeds to an authorized download.

### 31. ¿Cómo se evita OOM con imágenes?

The project bounds decoded RAM by estimated width×height×4, refuses oversize entries, decodes to at most 1440 px, clears visible state off viewport, cancels downloads and clears caches under memory pressure.

### 32. ¿Por qué autorizar antes de leer cache?

Cached bytes are resources, not permissions. Every acquisition requests current authorization before RAM or disk. A privacy-safe not-found also removes RAM/disk bytes and purges the decoder cache.

### 33. ¿Cómo comparten cache Posts y Stories sin colisionar?

They reuse the same RAM LRU, disk LRU, downloader and decoder. Post keys retain `author/media.ext`; Story keys use `story-media:author/media.ext`, so equal object paths from different buckets cannot collide.

### 34. ¿Qué evita una segunda cache automática de Expo Image?

The app supplies decoded/local image data and renders with `cachePolicy="none"`. After decode and memory pressure it calls Expo Image cache purge APIs, leaving the custom L1/L2 budgets as the deliberate caches.

### 35. ¿Cómo se limita el prefetch de Stories?

The viewer owns at most the current lease and one next-Story prefetch lease. Navigation/dispose cancels obsolete leases, so traversing many authors does not create an unbounded download queue.

## Stories, exceptions and security

### 36. ¿Por qué Stories expiran por timestamp y no por boolean?

Activity is derived from server time: `created_at > current_timestamp - interval '24 hours'`. No cleanup race can leave a stale mutable flag; exactly 24 hours is already expired.

### 37. ¿Por qué seen de Stories es local?

The assignment needs local persistence for UX rings, not a social receipt. It is stored per owner in a separate SQLite database, avoiding a business mutation and preserving privacy.

### 38. ¿Cómo sabemos si un ring está completamente visto sin descargar todas las Stories?

After finishing all pages for an author, Mobile stores a snapshot with newest Story timestamp and active count. A tray is fully seen only when the newest timestamp matches and the snapshot count covers the current active count.

### 39. ¿Qué ocurre si una Story expira mientras está abierta?

Foreground/viewer revalidation or the next authorized media read returns privacy-safe not-found. The controller drops that Story without marking it seen and moves to the next valid Story/author.

### 40. ¿Cómo evitamos enumerar recursos privados?

Protected reads merge “does not exist” and “not authorized” into the same 404/domain not-found behavior. Broadcast payloads are minimal, and Edge never returns private row details before authorization.

### 41. ¿Qué pasa con un 409?

It represents an idempotency conflict: a client UUID already exists with different immutable content/path. The app surfaces a terminal domain outcome rather than retrying forever or overwriting canonical data.

### 42. ¿Cómo se maneja una respuesta backend malformada?

Each feature has an exact DTO parser with required fields, UUID/timestamp/order checks and no silent coercion. Failure becomes `invalid-response`; the object is not admitted into application state.

### 43. ¿Qué ocurre si SQLite falla?

The mutation queue reports `unavailable` and does not claim a command was completed; the row remains retryable when possible. Story seen is less critical and falls back to in-memory state for that session.

### 44. ¿Qué ocurre si Realtime se desconecta?

The UI keeps canonical state already fetched. Realtime reconnect/focus triggers refresh paths, and ID hints never replace HTTP/SQL truth. No offline DM send is promised.

### 45. ¿Qué limitaciones de validación real siguen pendientes?

There is no Android SDK/ADB/device, hosted Supabase configuration, deployed Realtime session or FPS/memory trace. Therefore native deep links, share sheet, ImagePicker `content://`, gestures/onDisplay, WebSockets, `gfxinfo` and `meminfo` remain unvalidated.

### 46. ¿Cómo se protege la lista de seguidores de un perfil privado?

`list_profile_followers` y `list_profile_following` autorizan primero al target: permiten self, perfil público o un `follows(actor,target)` actual. Edge obtiene actor del JWT y los casos privado oculto e inexistente producen el mismo `profile_not_found`.

### 47. ¿Por qué una solicitud pendiente no permite ver esas listas?

La autorización consulta exclusivamente la relación aceptada actual en `public.follows`. `follow_requests` conserva pending/rejected/history, pero ninguna de esas filas se usa como permiso; tampoco autoriza que el target siga al actor en dirección inversa.

### 48. ¿Cómo diferenciamos followers de following en SQL?

Followers(X) fija `followed_id = X` y devuelve el perfil de `follower_id`. Following(X) fija `follower_id = X` y devuelve el perfil de `followed_id`. Dos RPCs explícitas hacen visible esa diferencia y evitan invertir la relación accidentalmente.

### 49. ¿Por qué estas listas usan keyset y no OFFSET?

Cada página continúa después de `(created_at, counterpart UUID)` en orden descendente. El UUID desempata relaciones con el mismo timestamp, evita duplicados/omisiones al recorrer páginas y no obliga a PostgreSQL a saltar un número creciente de filas.

### 50. ¿Por qué no hacemos una petición Profile por cada fila?

Una vez autorizada la lista del target, una sola RPC une `follows` con `profiles` y devuelve los resúmenes mínimos de toda la página. Así se evita N+1; cada perfil conserva sus propias reglas cuando el usuario toca una fila.

### 51. ¿Por qué no se persistió `com.juanes1706.miapp`?

It was only a value selected during a temporary prebuild. No tracked metadata proves it is the intended permanent identity. Inventing a package could break signing/submission continuity, so the owner must choose and persist it before a release build.

### 52. ¿Por qué no afirmamos compatibilidad con Java 25?

No Android SDK or Gradle build exists in this environment. A temporary prebuild/export does not compile native Gradle, so the final native build must use the JDK supported by the generated Expo toolchain and prove it with Gradle.
