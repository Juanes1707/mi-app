import { Stack, useLocalSearchParams } from 'expo-router';

import { DirectConversationScreen } from '@/features/direct-messages/presentation/screens/direct-conversation-screen';

export default function DirectConversationRoute() {
  const { conversationId } = useLocalSearchParams<'/messages/[conversationId]'>();
  return <><Stack.Screen options={{ headerShown: true, title: 'Conversación' }} />
    <DirectConversationScreen conversationId={typeof conversationId === 'string' ? conversationId : null} /></>;
}
