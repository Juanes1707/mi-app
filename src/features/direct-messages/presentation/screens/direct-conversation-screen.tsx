import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet,
  Text, TextInput, View, type ListRenderItem,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/features/auth/presentation/hooks/use-auth';
import type { DirectMessage } from '@/features/direct-messages/domain/direct-message';
import { normalizeDirectUuid } from '@/features/direct-messages/domain/direct-message-values';
import { useDirectConversation } from '@/features/direct-messages/presentation/hooks/use-direct-conversation';
import { useDirectConversationRealtime } from '@/features/direct-messages/presentation/hooks/use-direct-conversation-realtime';
import { ownMessageReceiptStatus, receiptLabel } from '@/features/direct-messages/presentation/receipt-overlay';
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

// Whether this screen is the one on top (Expo Router focus), for "read" semantics.
function useScreenFocused(): boolean {
  const [focused, setFocused] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => { if (mountedRef.current) setFocused(false); };
  }, []));
  return focused;
}

function AuthenticatedConversation({ ownerUserId, conversationId }: {
  ownerUserId: string; conversationId: string;
}) {
  const theme = useTheme();
  const chat = useDirectConversation(ownerUserId, conversationId);
  const { state, refresh, setDraft, send, discardFailedSend } = chat;
  const focused = useScreenFocused();
  const live = useDirectConversationRealtime({
    ownerUserId, conversationId, focused, ready: state.status === 'ready',
    messages: state.page.messages, mergeLiveMessage: chat.mergeLiveMessage,
  });
  const { overlay, notifyDraftEdited, stopTyping } = live;
  // Focus re-reads the history (missed hints are recovered here); blur withdraws typing.
  useFocusEffect(useCallback(() => {
    void refresh();
    return () => stopTyping();
  }, [refresh, stopTyping]));
  const renderItem: ListRenderItem<DirectMessage> = useCallback(({ item }) => {
    const isOwn = item.senderId === ownerUserId;
    return <MessageBubble message={item} isOwn={isOwn}
      receipt={isOwn ? receiptLabel(ownMessageReceiptStatus(item, overlay)) : null} />;
  }, [ownerUserId, overlay]);
  // The chat hook owns the draft and its revision; typing only observes the edit.
  const onChangeDraft = useCallback((text: string) => {
    setDraft(text);
    notifyDraftEdited(text);
  }, [setDraft, notifyDraftEdited]);
  const onSend = useCallback(() => {
    stopTyping();
    send();
  }, [stopTyping, send]);
  const onDiscard = useCallback(() => {
    stopTyping();
    discardFailedSend();
  }, [stopTyping, discardFailedSend]);

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
          extraData={overlay}
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
        {/* Fixed height: the indicator appearing never shifts the list. */}
        <View accessibilityLiveRegion="polite" style={styles.typingRow}>
          {live.peerTyping
            ? <Text style={[styles.typingText, { color: theme.textSecondary }]}>Escribiendo…</Text>
            : null}
        </View>
        {chat.pendingSend?.status === 'error' ? (
          <View style={[styles.sendError, { borderTopColor: theme.backgroundElement }]}>
            <Text style={[styles.sendErrorText, { color: theme.textSecondary }]}>No pudimos enviar el mensaje.</Text>
            <Pressable accessibilityRole="button" onPress={chat.retrySend}><Text style={styles.link}>Reintentar</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={onDiscard}><Text style={styles.link}>Descartar</Text></Pressable>
          </View>
        ) : null}
        <View style={[styles.composer, { borderTopColor: theme.backgroundElement }]}>
          <View style={styles.inputArea}>
            <TextInput
              accessibilityLabel="Mensaje"
              multiline
              onChangeText={onChangeDraft}
              placeholder="Escribe un mensaje"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              value={chat.draft}
            />
            <Text style={[styles.counter, { color: codePoints > 2000 ? '#C62828' : theme.textSecondary }]}>{codePoints}/2000</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Enviar mensaje" disabled={!canSend}
            onPress={onSend} style={[styles.send, !canSend && styles.disabled]}>
            {chat.pendingSend?.status === 'sending' ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>Enviar</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// `receipt` only for the owner's messages: Enviado / Entregado / Visto.
function MessageBubble({ message, isOwn, receipt }: { message: DirectMessage; isOwn: boolean; receipt: string | null }) {
  const theme = useTheme();
  const time = formatMessageTime(message.createdAt);
  return <View style={[styles.bubbleRow, isOwn ? styles.ownRow : styles.peerRow]}>
    <View style={[styles.bubble, { backgroundColor: isOwn ? '#208AEF' : theme.backgroundElement }]}>
      <Text style={[styles.body, { color: isOwn ? '#fff' : theme.text }]}>{message.body}</Text>
      <Text style={[styles.messageTime, { color: isOwn ? '#E5F2FF' : theme.textSecondary }]}>
        {receipt === null ? time : `${time} · ${receipt}`}
      </Text>
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
  typingRow: { height: 18, justifyContent: 'center', paddingHorizontal: 14 }, typingText: { fontSize: 12, fontStyle: 'italic' },
});
