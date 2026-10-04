# Hosted demo fixtures

These scripts create a small demo ecosystem in the dedicated Hosted Supabase project. They are development tools and are never imported by the Expo application.

## Setup

Create `.env.seed.local` in the repository root:

```env
DEMO_SUPABASE_SECRET_KEY=
DEMO_FIXTURE_PASSWORD=
DEMO_OWNER_EMAIL=
DEMO_SEED_CONFIRM=YES
```

`DEMO_OWNER_EMAIL` is optional. It lets Alba and Bruno follow the existing user and send incoming demo messages without reading or changing the owner's password.

**NEVER commit `.env.seed.local`. NEVER use the secret key in Expo/Mobile or in any `EXPO_PUBLIC_*` variable.**

The safety lock requires the public `.env` to point exactly to project `nkhrypgiagaofovulnnq` and `DEMO_SEED_CONFIRM` to equal `YES`. Missing either condition causes zero writes.

## Seed

```powershell
node --env-file=.env --env-file=.env.seed.local scripts/demo-fixtures/seed.mjs
```

The script creates or reuses exactly six allow-listed Auth users, signs in as each user, and sends all business operations through the deployed Edge Functions. Posts reuse an ignored local manifest because the real backend chooses their media paths. Story IDs are derived from the UTC day, fixture and slot: reruns on the same day are exact replays, while a later day can create active replacements without changing old timestamps.

Generated PNGs are created in memory with Node built-ins and are never written to the repository. Run the seed twice to verify idempotency.

Fixture credentials are each fixture email shown in `shared.mjs` plus the local `DEMO_FIXTURE_PASSWORD`. The password is never printed.

## Peer simulator

Run these while the human account is open in Expo Go:

```powershell
node --env-file=.env --env-file=.env.seed.local scripts/demo-fixtures/peer.mjs message --from demo_alba --to-email USER@EMAIL --text "Hola desde Alba"

node --env-file=.env --env-file=.env.seed.local scripts/demo-fixtures/peer.mjs typing --from demo_alba --to-email USER@EMAIL --seconds 3

node --env-file=.env --env-file=.env.seed.local scripts/demo-fixtures/peer.mjs follow --from demo_camila --to-email USER@EMAIL
```

`message` and `follow` use the fixture JWT with the real HTTP Edge API. `typing` joins the private Realtime topic as the fixture user and sends `typing=true`, waits, sends `typing=false`, then removes the channel.

## Cleanup

```powershell
node --env-file=.env --env-file=.env.seed.local scripts/demo-fixtures/cleanup.mjs
```

Cleanup has an exact six-email allow-list. For each matching Auth user it removes only `post-media/<fixtureUserId>/...` and `story-media/<fixtureUserId>/...`, then deletes that fixture Auth user. Database cascades remove its profile and related fixture rows. It never deletes or modifies the configured owner.
