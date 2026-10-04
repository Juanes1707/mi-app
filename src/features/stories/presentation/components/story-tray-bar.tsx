import { memo, useCallback, useMemo } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, type ListRenderItem } from 'react-native';

import type { StoryPublicationState } from '@/features/stories/application/story-publication-controller';
import type { StoryTrayState } from '@/features/stories/application/story-tray-controller';
import type { StoryTray } from '@/features/stories/domain/story';
import { StoryAvatar, storyAuthorName, STORY_UNSEEN_RING_COLOR } from '@/features/stories/presentation/components/story-avatar';
import { buildStoryTrayItems, type StoryTrayItem } from '@/features/stories/presentation/story-tray-items';
import { useTheme } from '@/hooks/use-theme';


type StoryTrayBarProps = {
  ownerInitialSource: string;
  tray: StoryTrayState;
  isFullySeen: (tray: StoryTray) => boolean;
  publication: StoryPublicationState;
  publishing: boolean;
  onOpenAuthor: (authorId: string) => void;
  onAddStory: () => void;
  onRetryTray: () => void;
  onLoadMore: () => void;
  onRetryLoadMore: () => void;
  onRetryPublication: () => void;
  onDiscardPublication: () => void;
};

const getKey = (item: StoryTrayItem) => item.key;

// Home Stories tray: the local "Tu historia" tile first (always, even without a server
// self tray), then the followed authors from the server, horizontally paginated.
export const StoryTrayBar = memo(function StoryTrayBar(props: StoryTrayBarProps) {
  const theme = useTheme();
  const { tray, isFullySeen, publishing, onOpenAuthor, onAddStory, ownerInitialSource } = props;
  const items = useMemo(() => buildStoryTrayItems(tray.trays), [tray.trays]);

  const renderItem: ListRenderItem<StoryTrayItem> = useCallback(({ item }) => {
    if (item.key === 'self' || item.tray === null) {
      return (
        <SelfTile
          tray={item.tray}
          seen={item.tray !== null && isFullySeen(item.tray)}
          initialSource={ownerInitialSource}
          publishing={publishing}
          onOpen={onOpenAuthor}
          onAdd={onAddStory}
        />
      );
    }
    const author = item.tray.author;
    const name = storyAuthorName(author);
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`Ver historias de ${name}`}
        onPress={() => onOpenAuthor(author.id)} style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
        <StoryAvatar name={name} ring={isFullySeen(item.tray) ? 'seen' : 'unseen'} />
        <Text numberOfLines={1} style={[styles.label, { color: theme.text }]}>{name}</Text>
      </Pressable>
    );
  }, [isFullySeen, onAddStory, onOpenAuthor, ownerInitialSource, publishing, theme.text]);

  return (
    <View style={[styles.container, { borderBottomColor: theme.backgroundElement }]}>
      <FlatList
        horizontal
        data={items}
        extraData={isFullySeen}
        keyExtractor={getKey}
        renderItem={renderItem}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        onEndReached={props.onLoadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          tray.status === 'loading' || tray.operation === 'loading-more' ? (
            <View style={styles.footer}><ActivityIndicator accessibilityLabel="Cargando historias" color={theme.text} /></View>
          ) : tray.status === 'error' ? (
            <SmallAction label="Reintentar" hint="No pudimos cargar las historias." onPress={props.onRetryTray} />
          ) : tray.loadMoreError ? (
            <SmallAction label="Reintentar" hint="No pudimos cargar más historias." onPress={props.onRetryLoadMore} />
          ) : null
        }
      />
      <PublicationStatus
        state={props.publication}
        onRetry={props.onRetryPublication}
        onDiscard={props.onDiscardPublication}
      />
    </View>
  );
});

function SelfTile({ tray, seen, initialSource, publishing, onOpen, onAdd }: {
  tray: StoryTray | null;
  seen: boolean;
  initialSource: string;
  publishing: boolean;
  onOpen: (authorId: string) => void;
  onAdd: () => void;
}) {
  const theme = useTheme();
  // With an active Story the tile opens the viewer and "+" publishes; without one,
  // the whole tile publishes.
  const openOrAdd = tray !== null ? () => onOpen(tray.author.id) : onAdd;
  return (
    <View style={styles.tile}>
      <Pressable accessibilityRole="button" accessibilityLabel="Tu historia" disabled={tray === null && publishing}
        onPress={openOrAdd} style={({ pressed }) => [pressed && styles.pressed]}>
        <StoryAvatar name={tray ? storyAuthorName(tray.author) : initialSource} ring={tray === null ? 'none' : seen ? 'seen' : 'unseen'} />
        {publishing ? (
          <View style={styles.publishing}><ActivityIndicator color="#fff" /></View>
        ) : null}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Añadir historia" disabled={publishing}
        hitSlop={8} onPress={onAdd}
        style={[styles.plus, { borderColor: theme.background }, publishing && styles.disabled]}>
        <Text style={styles.plusText}>+</Text>
      </Pressable>
      <Text numberOfLines={1} style={[styles.label, { color: theme.text }]}>Tu historia</Text>
    </View>
  );
}

const PUBLICATION_MESSAGES: Partial<Record<string, string>> = {
  'invalid-image': 'Elige una imagen JPG, PNG o WebP.',
  'image-too-large': 'La imagen supera el máximo de 10 MB.',
};

function PublicationStatus({ state, onRetry, onDiscard }: {
  state: StoryPublicationState;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const theme = useTheme();
  if (state.phase === 'success') {
    return <Text accessibilityLiveRegion="polite" style={[styles.status, { color: theme.textSecondary }]}>Historia publicada</Text>;
  }
  if (state.phase === 'preparing' || state.phase === 'uploading' || state.phase === 'publishing') {
    return <Text accessibilityLiveRegion="polite" style={[styles.status, { color: theme.textSecondary }]}>Publicando historia…</Text>;
  }
  if (state.phase !== 'error' || state.error === null) return null;
  const message = PUBLICATION_MESSAGES[state.error.code] ?? 'No pudimos publicar tu historia.';
  return (
    <View accessibilityLiveRegion="polite" style={styles.statusRow}>
      <Text style={[styles.status, styles.statusText, { color: theme.textSecondary }]}>{message}</Text>
      {state.canRetry ? <SmallAction label="Reintentar" onPress={onRetry} /> : null}
      <SmallAction label="Descartar" onPress={onDiscard} />
    </View>
  );
}

function SmallAction({ label, hint, onPress }: { label: string; hint?: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.footer}>
      {hint ? <Text style={[styles.hint, { color: theme.textSecondary }]}>{hint}</Text> : null}
      <Pressable accessibilityRole="button" onPress={onPress}
        style={({ pressed }) => [styles.action, { backgroundColor: theme.backgroundElement }, pressed && styles.pressed]}>
        <Text style={[styles.actionText, { color: theme.text }]}>{label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10 },
  list: { gap: 12, paddingHorizontal: 12 },
  tile: { alignItems: 'center', width: 76 },
  label: { fontSize: 12, marginTop: 4, maxWidth: 76 },
  pressed: { opacity: 0.7 },
  publishing: {
    alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.35)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0,
    borderRadius: 32, justifyContent: 'center',
  },
  plus: {
    alignItems: 'center', backgroundColor: STORY_UNSEEN_RING_COLOR, borderRadius: 12, borderWidth: 2,
    height: 24, justifyContent: 'center', position: 'absolute', right: 4, top: 44, width: 24,
  },
  plusText: { color: '#fff', fontSize: 16, fontWeight: '800', lineHeight: 18 },
  disabled: { opacity: 0.45 },
  footer: { alignItems: 'center', gap: 6, justifyContent: 'center', minHeight: 64, paddingHorizontal: 8 },
  hint: { fontSize: 12, maxWidth: 160, textAlign: 'center' },
  action: { borderRadius: 10, justifyContent: 'center', minHeight: 36, paddingHorizontal: 14 },
  actionText: { fontSize: 13, fontWeight: '600' },
  status: { fontSize: 13, paddingHorizontal: 16, paddingTop: 6 },
  statusRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', paddingRight: 8 },
  statusText: { flexShrink: 1 },
});
