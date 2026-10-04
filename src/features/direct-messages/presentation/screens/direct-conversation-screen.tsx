import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet,
  Text, TextInput, View, type ListRenderItem,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/features/auth/presentation/hooks/use-auth';
import type { DirectMessage } from '@/features/direct-messages/domain/direct-message';
import { normalizeDirectUuid } from '@/features/direct-messages/domain/direct-message-values';
import { useDirectConversation } from '@/features/direct-messages/presentation/hooks/use-direct-conversation';
import { useTheme } from '@/hooks/use-theme';
import { parsePostgresTimestamp } from '@/shared/domain/postgres-timestamp';

type Props = { conversationId: string | null };
const timeFormatter = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit' });

// From the parsed instant, not Date's engine-specific parsing of microsecond strings.
function formatMessageTime(createdAt: string): string {
  const timestamp = parsePostgresTimestamp(createdAt);
  return timestamp === null ? '' : timeFormatter.format(new Date(timestamp.epochMilliseconds));
}

export function DirectConversationScreen({ conversationId }: Props) {
  const normalized = normalizeDirectUuid(conversationId);
  if (normalized === null) return <Feedback message="Conversación no válida." />;
  return <ValidConversation conversationId={normalized} />;
}

function ValidConversation({ conversationId }: { conversationId: string }) {
  const { user } = useAuth();
  if (user === null) return <Feedback message="Tu sesión no está disponible." />;
  return <AuthenticatedConversation ownerUserId={user.id.toLowerCase()} conversationId={conversationId} />;
}

function AuthenticatedConversation({ ownerUserId, conversationId }: {
  ownerUserId: string; conversationId: string;
}) {
  const theme = useTheme();
  const chat = useDirectConversation(ownerUserId, conversationId);
  const { state } = chat;
  useFocusEffect(useCallback(() => { void chat.refresh(); }, [chat.refresh]));
  const renderItem: ListRenderItem<DirectMessage> = useCallback(({ item }) => (
    <MessageBubble message={item} isOwn={item.senderId === ownerUserId} />
  ), [ownerUserId]);

  if (state.status === 'loading') return <Feedback loading message="Cargando conversación..." />;
  if (state.status === 'not-found') return <Feedback message="Esta conversación ya no está disponible." />;
  if (state.status === 'error') return <Feedback message="No pudimos cargar la conversación." onRetry={chat.retry} />;
  const codePoints = [...chat.draft].length;
  const canSend = chat.pendingSend === null && chat.draft.trim() !== '' && codePoints <= 2000 && !chat.draft.includes('\u0000');
  return (
    <SafeAreaView edges={['bottom']} style={[styles.screen, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
        {state.refreshError ? <Feedback message="No pudimos actualizar la conversación." onRetry={chat.refresh} /> : null}
        <FlatList
          contentContainerStyle={styles.list}
          data={state.page.messages}
          inverted
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListEmptyComponent={<Feedback message="Envía el primer mensaje." />}
          ListFooterComponent={state.operation === 'loading-more'
            ? <Feedback loading message="Cargando mensajes anteriores..." />
            : state.loadMoreError ? <Feedback message="No pudimos cargar mensajes anteriores." onRetry={chat.retryLoadMore} /> : null}
          onEndReached={chat.onEndReached}
          onEndReachedThreshold={0.4}
          onRefresh={chat.refresh}
          refreshing={state.operation === 'refreshing'}
        />
        {chat.pendingSend?.status === 'error' ? (
          <View style={[styles.sendError, { borderTopColor: theme.backgroundElement }]}>
            <Text style={[styles.sendErrorText, { color: theme.textSecondary }]}>No pudimos enviar el mensaje.</Text>
            <Pressable accessibilityRole="button" onPress={chat.retrySend}><Text style={styles.link}>Reintentar</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={chat.discardFailedSend}><Text style={styles.link}>Descartar</Text></Pressable>
          </View>
        ) : null}
        <View style={[styles.composer, { borderTopColor: theme.backgroundElement }]}>
          <View style={styles.inputArea}>
            <TextInput
              accessibilityLabel="Mensaje"
              multiline
              onChangeText={chat.setDraft}
              placeholder="Escribe un mensaje"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              value={chat.draft}
            />
            <Text style={[styles.counter, { color: codePoints > 2000 ? '#C62828' : theme.textSecondary }]}>{codePoints}/2000</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Enviar mensaje" disabled={!canSend}
            onPress={chat.send} style={[styles.send, !canSend && styles.disabled]}>
            {chat.pendingSend?.status === 'sending' ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>Enviar</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MessageBubble({ message, isOwn }: { message: DirectMessage; isOwn: boolean }) {
  const theme = useTheme();
  return <View style={[styles.bubbleRow, isOwn ? styles.ownRow : styles.peerRow]}>
    <View style={[styles.bubble, { backgroundColor: isOwn ? '#208AEF' : theme.backgroundElement }]}>
      <Text style={[styles.body, { color: isOwn ? '#fff' : theme.text }]}>{message.body}</Text>
      <Text style={[styles.messageTime, { color: isOwn ? '#E5F2FF' : theme.textSecondary }]}>{formatMessageTime(message.createdAt)}</Text>
    </View>
  </View>;
}

function Feedback({ message, onRetry, loading = false }: { message: string; onRetry?: () => void; loading?: boolean }) {
  const theme = useTheme();
  return <View accessibilityLiveRegion="polite" style={styles.feedback}>
    {loading ? <ActivityIndicator color={theme.text} /> : null}
    <Text style={[styles.feedbackText, { color: theme.textSecondary }]}>{message}</Text>
    {onRetry ? <Pressable accessibilityRole="button" onPress={onRetry}><Text style={styles.link}>Reintentar</Text></Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, list: { flexGrow: 1, padding: 12 },
  bubbleRow: { flexDirection: 'row', marginVertical: 4 }, ownRow: { justifyContent: 'flex-end' }, peerRow: { justifyContent: 'flex-start' },
  bubble: { borderRadius: 16, maxWidth: '82%', paddingHorizontal: 13, paddingVertical: 9 },
  body: { fontSize: 15, lineHeight: 21 }, messageTime: { alignSelf: 'flex-end', fontSize: 10, marginTop: 4 },
  composer: { alignItems: 'flex-end', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 8, padding: 10 },
  inputArea: { flex: 1 }, input: { borderRadius: 16, maxHeight: 120, minHeight: 44, paddingHorizontal: 14, paddingVertical: 10 },
  counter: { alignSelf: 'flex-end', fontSize: 10, marginRight: 6, marginTop: 2 },
  send: { alignItems: 'center', backgroundColor: '#208AEF', borderRadius: 12, justifyContent: 'center', minHeight: 44, minWidth: 72 },
  sendText: { color: '#fff', fontWeight: '700' }, disabled: { opacity: 0.45 },
  sendError: { alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 14, padding: 10 },
  sendErrorText: { flex: 1, fontSize: 13 }, feedback: { alignItems: 'center', gap: 10, justifyContent: 'center', padding: 22 },
  feedbackText: { fontSize: 14, textAlign: 'center' }, link: { color: '#208AEF', fontWeight: '700' },
});
