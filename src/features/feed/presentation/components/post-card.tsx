import { SymbolView } from 'expo-symbols';
import { memo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import type { Post } from '@/features/feed/domain/entities/post';
import { PostImage } from '@/features/feed/presentation/components/post-image';
import { useTheme } from '@/hooks/use-theme';

type PostCardProps = {
  post: Post;
};

const dateFormatter = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric',
  month: 'long',
});

export const PostCard = memo(function PostCard({ post }: PostCardProps) {
  const theme = useTheme();
  const publishedAt = dateFormatter.format(new Date(post.createdAt));

  return (
    <View style={[styles.card, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Image
          accessibilityLabel={`Foto de perfil de ${post.author.displayName}`}
          source={{ uri: post.author.avatarUrl }}
          style={styles.avatar}
        />
        <View style={styles.authorText}>
          <Text numberOfLines={1} style={[styles.username, { color: theme.text }]}>
            {post.author.username}
          </Text>
          <Text numberOfLines={1} style={[styles.displayName, { color: theme.textSecondary }]}>
            {post.author.displayName}
          </Text>
        </View>
      </View>

      <PostImage
        accessibilityLabel={`Publicación de ${post.author.displayName}: ${post.caption}`}
        imageUrl={post.imageUrl}
      />

      <View style={styles.details}>
        <View accessibilityLabel="Acciones de la publicación, próximamente disponibles" style={styles.actions}>
          <SymbolView
            name={{ ios: 'heart', android: 'favorite_border', web: 'favorite_border' }}
            size={26}
            tintColor={theme.text}
          />
          <SymbolView
            name={{ ios: 'bubble.left', android: 'chat_bubble_outline', web: 'chat_bubble_outline' }}
            size={24}
            tintColor={theme.text}
          />
          <SymbolView
            name={{ ios: 'paperplane', android: 'send', web: 'send' }}
            size={24}
            tintColor={theme.text}
          />
        </View>

        <Text style={[styles.likes, { color: theme.text }]}>
          {post.likeCount.toLocaleString('es-CO')} Me gusta
        </Text>

        <Text style={[styles.caption, { color: theme.text }]}>
          <Text style={styles.captionUsername}>{post.author.username}</Text> {post.caption}
        </Text>

        <Text style={[styles.comments, { color: theme.textSecondary }]}>
          Ver los {post.commentCount.toLocaleString('es-CO')} comentarios
        </Text>
        <Text style={[styles.date, { color: theme.textSecondary }]}>{publishedAt}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    width: '100%',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  avatar: {
    borderRadius: 20,
    height: 40,
    width: 40,
  },
  authorText: {
    flex: 1,
  },
  username: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 19,
  },
  displayName: {
    fontSize: 12,
    lineHeight: 16,
  },
  details: {
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 18,
    height: 28,
  },
  likes: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  caption: {
    fontSize: 14,
    lineHeight: 20,
  },
  captionUsername: {
    fontWeight: '700',
  },
  comments: {
    fontSize: 14,
    lineHeight: 20,
  },
  date: {
    fontSize: 12,
    lineHeight: 16,
  },
});
