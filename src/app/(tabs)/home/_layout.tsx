import { Stack } from 'expo-router';

export default function HomeStackLayout() {
  return (
    <Stack initialRouteName="index" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="create" options={{ headerShown: true, title: 'Nueva publicación' }} />
      <Stack.Screen name="profile/[profileId]" options={{ headerShown: true, title: 'Perfil' }} />
      <Stack.Screen name="comments/[postId]" options={{ headerShown: true, title: 'Comentarios' }} />
    </Stack>
  );
}
