import { Stack } from 'expo-router';

export default function ActivityStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen
        name="profile/[profileId]"
        options={{
          headerShown: true,
          title: 'Perfil',
        }}
      />
    </Stack>
  );
}
