import { Stack } from 'expo-router';

export default function ExploreStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen
        name="profile/[profileId]"
        options={{ headerShown: true, title: 'Perfil' }}
      />
    </Stack>
  );
}
