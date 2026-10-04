import { Stack, useLocalSearchParams } from 'expo-router';

import { ProfileConnectionsScreen } from '@/features/profile-connections/presentation/screens/profile-connections-screen';

export default function FollowingRoute() {
  const { userId } = useLocalSearchParams<{ userId?: string | string[] }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Seguidos' }} />
      <ProfileConnectionsScreen
        kind="following"
        targetUserId={typeof userId === 'string' ? userId : null}
      />
    </>
  );
}
