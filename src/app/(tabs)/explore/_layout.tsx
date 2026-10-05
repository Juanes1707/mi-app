import { Stack } from 'expo-router';

export default function ExploreStackLayout() {
  return (
    <Stack initialRouteName="index" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="profile/[profileId]"
        options={{ headerShown: true, title: 'Perfil' }}
      />
    </Stack>
  );
}
