import {
  FIXTURES,
  createAdminClient,
  findAuthUserByEmail,
  loadConfig,
  removeManifest,
} from './shared.mjs';

async function removeUserObjects(admin, bucket, userId) {
  for (;;) {
    const { data, error } = await admin.storage.from(bucket).list(userId, { limit: 100, offset: 0 });
    if (error) throw new Error(`Unable to list fixture objects in ${bucket}.`);
    if (!data?.length) return;
    const paths = data.filter((entry) => entry.id !== null).map((entry) => `${userId}/${entry.name}`);
    if (!paths.length) return;
    const { error: removeError } = await admin.storage.from(bucket).remove(paths);
    if (removeError) throw new Error(`Unable to remove fixture objects in ${bucket}.`);
  }
}

async function main() {
  const config = loadConfig();
  const admin = createAdminClient(config);
  let deleted = 0;
  for (const fixture of FIXTURES) {
    const user = await findAuthUserByEmail(admin, fixture.email);
    if (!user) continue;
    await removeUserObjects(admin, 'post-media', user.id);
    await removeUserObjects(admin, 'story-media', user.id);
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`Unable to delete fixture ${fixture.username}.`);
    deleted += 1;
  }
  await removeManifest();
  console.log(`Deleted ${deleted} allow-listed fixture users and their scoped media.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Demo cleanup failed.');
  process.exitCode = 1;
});
