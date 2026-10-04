import { Stack } from 'expo-router';

import { DirectInboxScreen } from '@/features/direct-messages/presentation/screens/direct-inbox-screen';

export default function DirectInboxRoute() {
  return <><Stack.Screen options={{ headerShown: true, title: 'Mensajes' }} /><DirectInboxScreen /></>;
}
