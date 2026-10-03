import { Stack } from 'expo-router';

export default function HomeStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="create" options={{ headerShown: true, title: 'Nueva publicación' }} />
      <Stack.Screen name="profile/[profileId]" options={{ headerShown: true, title: 'Perfil' }} />
    </Stack>
  );
}
