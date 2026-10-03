import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { FeedPost } from '@/features/feed/domain/entities/feed-post';
import { PostMediaImage } from '@/features/post-media/presentation/components/post-media-image';
import { useTheme } from '@/hooks/use-theme';

const dateFormatter = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric', month: 'long', year: 'numeric',
});

type PostCardProps = {
  post: FeedPost;
  isMediaVisible: boolean;
  // Displayed like state (server + pending local intentions), computed by the screen.
  isLiked: boolean;
  likesCount: number;
  likeSaveFailed: boolean;
  onToggleLike: (post: FeedPost) => void;
  onOpenAuthor: (profileId: string) => void;
};

const HEART_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

export const PostCard = memo(function PostCard({
  post, isMediaVisible, isLiked, likesCount, likeSaveFailed, onToggleLike, onOpenAuthor,
}: PostCardProps) {
  const theme = useTheme();
  const username = post.author.username?.trim();
  const name = post.author.displayName?.trim() || username || 'Usuario';
  const initial = [...(post.author.displayName?.trim() || username || '?')][0].toUpperCase();

  return (
    <View style={[styles.card, { backgroundColor: theme.background }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Ver perfil de ${name}`}
        onPress={() => onOpenAuthor(post.author.id)}
        style={({ pressed }) => [styles.header, pressed ? styles.pressed : undefined]}>
        <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
          <Text style={[styles.initial, { color: theme.text }]}>{initial}</Text>
        </View>
        <View style={styles.authorText}>
          <Text style={[styles.name, { color: theme.text }]}>{name}</Text>
          {username ? (
            <Text style={[styles.username, { color: theme.textSecondary }]}>@{username}</Text>
          ) : null}
        </View>
      </Pressable>

      <PostMediaImage
        accessibilityLabel={`Publicación de ${name}`}
        imagePath={post.imagePath}
        isVisible={isMediaVisible}
      />

      <View style={styles.details}>
        <View style={styles.likesRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isLiked ? 'Quitar Me gusta' : 'Dar Me gusta'}
            accessibilityState={{ selected: isLiked }}
            hitSlop={HEART_HIT_SLOP}
            onPress={() => onToggleLike(post)}
            style={({ pressed }) => (pressed ? styles.pressed : undefined)}>
            <Text style={[styles.heart, isLiked ? styles.liked : { color: theme.text }]}>
              {isLiked ? '♥' : '♡'}
            </Text>
          </Pressable>
          <Text style={[styles.likes, { color: theme.text }]}>
            {likesCount.toLocaleString('es-CO')} Me gusta
          </Text>
        </View>
        {likeSaveFailed ? (
          <Text accessibilityLiveRegion="polite" style={[styles.likeError, { color: theme.textSecondary }]}>
            No pudimos guardar tu acción.
          </Text>
        ) : null}
        <Text style={[styles.body, { color: theme.textSecondary }]}>
          {post.commentsCount.toLocaleString('es-CO')} comentarios
        </Text>
        {post.caption !== '' ? (
          <Text style={[styles.body, { color: theme.text }]}>
            <Text style={styles.captionName}>{username || name}</Text> {post.caption}
          </Text>
        ) : null}
        <Text style={[styles.date, { color: theme.textSecondary }]}>
          {dateFormatter.format(new Date(post.createdAt))}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { width: '100%' },
  header: { alignItems: 'center', flexDirection: 'row', gap: 12, padding: 16 },
  avatar: { borderRadius: 20, height: 40, width: 40, alignItems: 'center', justifyContent: 'center' },
  initial: { fontSize: 18, fontWeight: '700' },
  authorText: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: '700', lineHeight: 20 },
  username: { fontSize: 12, lineHeight: 18 },
  details: { gap: 8, paddingHorizontal: 16, paddingVertical: 14 },
  likesRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  heart: { fontSize: 22, lineHeight: 26 },
  likes: { fontSize: 16, fontWeight: '600', lineHeight: 24 },
  likeError: { fontSize: 12, lineHeight: 16 },
  liked: { color: '#D92545' },
  body: { fontSize: 14, lineHeight: 20 },
  captionName: { fontWeight: '700' },
  date: { fontSize: 12, lineHeight: 18 },
  pressed: { opacity: 0.7 },
});
