import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, type ListRenderItem } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/features/auth/presentation/hooks/use-auth';
import type { DirectConversationSummary } from '@/features/direct-messages/domain/direct-message';
import { useDirectInbox } from '@/features/direct-messages/presentation/hooks/use-direct-inbox';
import { useTheme } from '@/hooks/use-theme';
import { parsePostgresTimestamp } from '@/shared/domain/postgres-timestamp';

const dateFormatter = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// From the parsed instant, not Date's engine-specific parsing of microsecond strings.
function formatLastMessageTime(createdAt: string): string {
  const timestamp = parsePostgresTimestamp(createdAt);
  return timestamp === null ? '' : dateFormatter.format(new Date(timestamp.epochMilliseconds));
}

export function DirectInboxScreen() {
  const { user } = useAuth();
  if (user === null) return <Feedback message="Tu sesión no está disponible." />;
  return <AuthenticatedInbox ownerUserId={user.id.toLowerCase()} />;
}

function AuthenticatedInbox({ ownerUserId }: { ownerUserId: string }) {
  const theme = useTheme();
  const router = useRouter();
  const { state, refresh, retry, onEndReached, retryLoadMore } = useDirectInbox(ownerUserId);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const openConversation = useCallback((conversationId: string) => {
    router.push({ pathname: '/messages/[conversationId]', params: { conversationId } });
  }, [router]);
  const renderItem: ListRenderItem<DirectConversationSummary> = useCallback(({ item }) => (
    <ConversationRow conversation={item} onPress={openConversation} />
  ), [openConversation]);

  if (state.status === 'loading') return <Feedback loading message="Cargando mensajes..." />;
  if (state.status === 'error') return <Feedback message="No pudimos cargar tus mensajes." onRetry={retry} />;
  return (
    <SafeAreaView edges={['bottom']} style={[styles.screen, { backgroundColor: theme.background }]}>
      <FlatList
        contentContainerStyle={styles.list}
        data={state.page.conversations}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={<Feedback message="Todavía no tienes conversaciones." />}
        ListHeaderComponent={state.refreshError ? <Feedback message="No pudimos actualizar tus mensajes." onRetry={refresh} /> : null}
        ListFooterComponent={state.operation === 'loading-more'
          ? <Feedback loading message="Cargando más conversaciones..." />
          : state.loadMoreError ? <Feedback message="No pudimos cargar más conversaciones." onRetry={retryLoadMore} /> : null}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        onRefresh={refresh}
        refreshing={state.operation === 'refreshing'}
      />
    </SafeAreaView>
  );
}

function ConversationRow({ conversation, onPress }: {
  conversation: DirectConversationSummary; onPress: (id: string) => void;
}) {
  const theme = useTheme();
  const name = conversation.peer.displayName?.trim() || conversation.peer.username?.trim() || 'Usuario';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Abrir conversación con ${name}`}
      onPress={() => onPress(conversation.id)}
      style={({ pressed }) => [styles.row, { borderBottomColor: theme.backgroundElement }, pressed && styles.pressed]}>
      <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
        <Text style={[styles.avatarText, { color: theme.text }]}>{Array.from(name)[0]?.toUpperCase() ?? '?'}</Text>
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text numberOfLines={1} style={[styles.name, { color: theme.text }]}>{name}</Text>
          <Text style={[styles.time, { color: theme.textSecondary }]}>{formatLastMessageTime(conversation.lastMessage.createdAt)}</Text>
        </View>
        <View style={styles.rowBottom}>
          <Text numberOfLines={1} style={[styles.preview, { color: theme.textSecondary }]}>{conversation.lastMessage.body}</Text>
          {conversation.unreadCount > 0 ? (
            <View accessibilityLabel={`${conversation.unreadCount} mensajes sin leer`} style={styles.badge}>
              <Text style={styles.badgeText}>{conversation.unreadCount}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function Feedback({ message, onRetry, loading = false }: { message: string; onRetry?: () => void; loading?: boolean }) {
  const theme = useTheme();
  return <View accessibilityLiveRegion="polite" style={styles.feedback}>
    {loading ? <ActivityIndicator color={theme.text} /> : null}
    <Text style={[styles.feedbackText, { color: theme.textSecondary }]}>{message}</Text>
    {onRetry ? <Pressable accessibilityRole="button" onPress={onRetry}
      style={[styles.retry, { backgroundColor: theme.backgroundElement }]}><Text style={{ color: theme.text }}>Reintentar</Text></Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, list: { flexGrow: 1, alignSelf: 'center', width: '100%', maxWidth: 640 },
  row: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, minHeight: 76, padding: 14 },
  avatar: { alignItems: 'center', borderRadius: 24, height: 48, justifyContent: 'center', width: 48 },
  avatarText: { fontSize: 19, fontWeight: '700' }, rowBody: { flex: 1, gap: 4 },
  rowTop: { alignItems: 'center', flexDirection: 'row', gap: 8 }, rowBottom: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  name: { flex: 1, fontSize: 15, fontWeight: '700' }, time: { fontSize: 11 }, preview: { flex: 1, fontSize: 14 },
  badge: { alignItems: 'center', backgroundColor: '#208AEF', borderRadius: 12, minWidth: 24, paddingHorizontal: 7, paddingVertical: 3 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  feedback: { alignItems: 'center', gap: 12, justifyContent: 'center', padding: 24 },
  feedbackText: { fontSize: 14, textAlign: 'center' }, retry: { borderRadius: 10, minHeight: 44, justifyContent: 'center', paddingHorizontal: 22 },
  pressed: { opacity: 0.7 },
});
