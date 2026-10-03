import { memo } from 'react';
import { StyleSheet, Text } from 'react-native';

import {
  canReplyToLocal, type LocalComment, type LocalCommentStatus,
} from '@/features/comments/presentation/comment-overlay';
import { CommentAction, CommentFrame } from '@/features/comments/presentation/components/comment-row';
import { useTheme } from '@/hooks/use-theme';

const STATUS_LABELS: Record<LocalCommentStatus, string> = {
  saving: 'Guardando…',
  // Durable on the device. Also shown while sync is blocked (offline, server error,
  // conflict): the intention is kept and retried by later sync events.
  pending: 'Pendiente',
  // Left the queue without a known outcome yet: never claimed as sent.
  resolving: 'Pendiente',
  sent: 'Enviado',
  // Neutral on purpose: after a lost 201 a 404 replay is possible, so it may exist.
  terminal: 'Ya no se puede sincronizar este comentario.',
  'save-error': 'No se pudo guardar',
};

const OWN_REPLY_LABEL = 'tu comentario';

type LocalCommentRowProps = {
  local: LocalComment;
  depth: number;
  isExpanded: boolean;
  localRepliesCount: number;
  realtimeRepliesCount?: number;
  isOrphan: boolean;
  // Composer ready; replying also requires this comment to be durable.
  canInteract: boolean;
  onExpandReplies: (commentId: string, hasLocalReplies: boolean) => void;
  onCollapseReplies: (commentId: string) => void;
  onReply: (commentId: string, label: string) => void;
  onRetry: (commentId: string) => void;
  onDiscard: (commentId: string) => void;
};

// The user's own intention, shown until a server page contains it. The author is the
// signed-in user ("Tú"): no profile lookup per row and no username guessed from the
// session.
export const LocalCommentRow = memo(function LocalCommentRow({
  local, depth, isExpanded, localRepliesCount, realtimeRepliesCount = 0, isOrphan, canInteract,
  onExpandReplies, onCollapseReplies, onReply, onRetry, onDiscard,
}: LocalCommentRowProps) {
  const theme = useTheme();
  const failed = local.status === 'save-error';
  const status = isOrphan ? `${STATUS_LABELS[local.status]} · Respuesta` : STATUS_LABELS[local.status];

  return (
    <CommentFrame
      depth={depth}
      initial="T"
      name="Tú"
      handle={null}
      body={local.body}
      meta={(
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.status, { color: failed ? FAILED_COLOR : theme.textSecondary }]}>
          {status}
        </Text>
      )}>
      {failed ? (
        <>
          <CommentAction label="Reintentar" onPress={() => onRetry(local.commentId)} />
          <CommentAction label="Descartar" onPress={() => onDiscard(local.commentId)} />
        </>
      ) : local.status === 'terminal' ? (
        // The processor already finished it: no retry, only the local copy goes.
        <CommentAction label="Descartar" onPress={() => onDiscard(local.commentId)} />
      ) : (
        <CommentAction
          label="Responder"
          accessibilityLabel="Responder a tu comentario"
          disabled={!canInteract || !canReplyToLocal(local)}
          onPress={() => onReply(local.commentId, OWN_REPLY_LABEL)}
        />
      )}
      {localRepliesCount + realtimeRepliesCount > 0 ? (
        <CommentAction
          label={isExpanded ? 'Ocultar respuestas' : 'Ver respuestas'}
          expanded={isExpanded}
          onPress={() => (isExpanded
            ? onCollapseReplies(local.commentId)
            : onExpandReplies(local.commentId, true))}
        />
      ) : null}
    </CommentFrame>
  );
});

const FAILED_COLOR = '#D92545';

const styles = StyleSheet.create({
  status: { fontSize: 12, fontWeight: '600', lineHeight: 18 },
});
