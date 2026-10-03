import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { PostCommentsErrorCode } from '@/features/comments/domain/post-comments-error';
import type { BranchRowStatus } from '@/features/comments/presentation/comment-tree';
import { commentIndent } from '@/features/comments/presentation/components/comment-row';
import { useTheme } from '@/hooks/use-theme';

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

function errorMessage(error: PostCommentsErrorCode | null): string {
  switch (error) {
    case 'parent-not-found':
      return 'Este comentario ya no está disponible.';
    case 'profile-not-ready':
      return 'Tu perfil todavía no está listo.';
    case 'authentication-required':
      return 'Tu sesión no está disponible.';
    default:
      return 'No pudimos cargar las respuestas.';
  }
}

type CommentBranchStatusRowProps = {
  branchKey: string;
  depth: number;
  status: BranchRowStatus;
  error: PostCommentsErrorCode | null;
  // Next page ("Ver más respuestas") or retry of this branch only.
  onContinue: (branchKey: string) => void;
};

// State of ONE reply branch, shown under its comment: a failure here never
// replaces the rest of the screen.
export const CommentBranchStatusRow = memo(function CommentBranchStatusRow({
  branchKey, depth, status, error, onContinue,
}: CommentBranchStatusRowProps) {
  const theme = useTheme();
  // Aligned with the replies of this branch (their thread border + padding).
  const indent = { paddingLeft: commentIndent(depth) + (depth > 0 ? 12 : 0) };

  if (status === 'loading' || status === 'loading-more') {
    return (
      <View accessibilityLiveRegion="polite" style={[styles.row, indent]}>
        <ActivityIndicator color={theme.textSecondary} size="small" />
        <Text style={[styles.text, { color: theme.textSecondary }]}>
          {status === 'loading' ? 'Cargando respuestas...' : 'Cargando más respuestas...'}
        </Text>
      </View>
    );
  }

  if (status === 'more') {
    return (
      <View style={[styles.row, indent]}>
        <Button label="Ver más respuestas" onPress={() => onContinue(branchKey)} />
      </View>
    );
  }

  if (status === 'corrupt') {
    return (
      <View accessibilityLiveRegion="polite" style={[styles.row, indent]}>
        <Text style={[styles.text, { color: theme.textSecondary }]}>
          No pudimos mostrar estos comentarios.
        </Text>
      </View>
    );
  }

  return (
    <View accessibilityLiveRegion="polite" style={[styles.row, styles.wrap, indent]}>
      <Text style={[styles.text, { color: theme.textSecondary }]}>{errorMessage(error)}</Text>
      {error !== 'parent-not-found' ? (
        <Button label="Reintentar" onPress={() => onContinue(branchKey)} />
      ) : null}
    </View>
  );
});

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={HIT_SLOP}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed ? styles.pressed : undefined]}>
      <Text style={[styles.buttonText, { color: theme.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 44, paddingRight: 16 },
  wrap: { flexWrap: 'wrap' },
  text: { flexShrink: 1, fontSize: 13, lineHeight: 18 },
  button: { justifyContent: 'center', minHeight: 44 },
  buttonText: { fontSize: 13, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
