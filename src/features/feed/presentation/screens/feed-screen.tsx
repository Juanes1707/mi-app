import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTabInset } from '@/constants/theme';
import { GetFeedPosts } from '@/features/feed/application/use-cases/get-feed-posts';
import { MockPostRepository } from '@/features/feed/data/repositories/mock-post-repository';
import type { Post } from '@/features/feed/domain/entities/post';
import { PostCard } from '@/features/feed/presentation/components/post-card';
import { useTheme } from '@/hooks/use-theme';

type FeedState =
  | { status: 'loading'; posts: Post[] }
  | { status: 'success'; posts: Post[] }
  | { status: 'error'; posts: Post[] };

const getFeedPosts = new GetFeedPosts(new MockPostRepository());

const renderPost: ListRenderItem<Post> = ({ item }) => <PostCard post={item} />;
const getPostKey = (post: Post) => post.id;

function FeedHeader() {
  const theme = useTheme();

  return (
    <View style={[styles.header, { borderBottomColor: theme.backgroundElement }]}>
      <Text style={[styles.title, { color: theme.text }]}>Inicio</Text>
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Momentos de tu comunidad</Text>
    </View>
  );
}

function PostSeparator() {
  const theme = useTheme();
  return <View style={[styles.separator, { backgroundColor: theme.backgroundElement }]} />;
}

export function FeedScreen() {
  const theme = useTheme();
  const [state, setState] = useState<FeedState>({ status: 'loading', posts: [] });

  useEffect(() => {
    let isMounted = true;

    getFeedPosts
      .execute()
      .then((posts) => {
        if (isMounted) {
          setState({ status: 'success', posts });
        }
      })
      .catch(() => {
        if (isMounted) {
          setState({ status: 'error', posts: [] });
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (state.status === 'loading') {
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: theme.background }]}>
        <ActivityIndicator accessibilityLabel="Cargando publicaciones" color={theme.text} size="large" />
        <Text style={[styles.statusText, { color: theme.textSecondary }]}>Cargando publicaciones…</Text>
      </SafeAreaView>
    );
  }

  if (state.status === 'error') {
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: theme.background }]}>
        <Text style={[styles.errorTitle, { color: theme.text }]}>No pudimos cargar el feed</Text>
        <Text style={[styles.statusText, { color: theme.textSecondary }]}>Vuelve a intentarlo más tarde.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: theme.background }]}>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={state.posts}
        ItemSeparatorComponent={PostSeparator}
        keyExtractor={getPostKey}
        ListHeaderComponent={FeedHeader}
        renderItem={renderPost}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  listContent: {
    alignSelf: 'center',
    paddingBottom: BottomTabInset + 24,
    width: '100%',
    maxWidth: 640,
  },
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
    paddingBottom: 14,
    paddingHorizontal: 16,
    paddingTop: Platform.select({ web: 82, default: 10 }),
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.6,
    lineHeight: 32,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  separator: {
    height: 8,
  },
  centered: {
    alignItems: 'center',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    padding: 24,
  },
  statusText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
    textAlign: 'center',
  },
});
