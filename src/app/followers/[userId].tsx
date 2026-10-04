import { Stack, useLocalSearchParams } from 'expo-router';

import { ProfileConnectionsScreen } from '@/features/profile-connections/presentation/screens/profile-connections-screen';

export default function FollowersRoute() {
  const { userId } = useLocalSearchParams<{ userId?: string | string[] }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Seguidores' }} />
      <ProfileConnectionsScreen
        kind="followers"
        targetUserId={typeof userId === 'string' ? userId : null}
      />
    </>
  );
}
