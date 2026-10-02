import { Stack } from 'expo-router';

export default function ProfileStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen
        name="edit"
        options={{
          headerShown: true,
          title: 'Editar perfil',
        }}
      />
    </Stack>
  );
}
