import { SupabaseAccessTokenProvider } from '@/features/auth/data/providers/supabase-access-token-provider';
import { GetPostComment } from '@/features/comments/application/get-post-comment';
import { GetPostCommentsPage } from '@/features/comments/application/get-post-comments-page';
import { BackendPostCommentsRepository } from '@/features/comments/data/backend-post-comments-repository';
import { SupabasePostCommentRealtimeSource } from '@/features/comments/data/supabase-post-comment-realtime-source';
import type { PostCommentRealtimeSource } from '@/features/comments/domain/post-comment-realtime';
import { authenticatedBackendApiClient } from '@/infrastructure/api/backend-api-container';
import { supabase } from '@/infrastructure/supabase/supabase-client';

const postCommentsRepository = new BackendPostCommentsRepository(authenticatedBackendApiClient);
export const getPostCommentsPage = new GetPostCommentsPage(postCommentsRepository);
export const getPostComment = new GetPostComment(postCommentsRepository);

// The shared Supabase client is used ONLY as Realtime transport here (controlled
// exception, like Auth): business data always comes from the authorized HTTP API.
export const postCommentRealtimeSource: PostCommentRealtimeSource = new SupabasePostCommentRealtimeSource(
  supabase,
  new SupabaseAccessTokenProvider(),
);
