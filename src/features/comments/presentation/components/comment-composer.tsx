import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { ComposerBodyIssue } from '@/features/comments/presentation/hooks/use-optimistic-post-comments';
import { MAX_POST_COMMENT_BODY_CODE_POINTS } from '@/features/offline-sync/domain/post-comment-body';
import { useTheme } from '@/hooks/use-theme';

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };
const ERROR_COLOR = '#D92545';

type CommentComposerProps = {
  value: string;
  onChangeText: (text: string) => void;
  // False until the user's pending comments are known.
  editable: boolean;
  canSend: boolean;
  onSend: () => void;
  // Unicode code points (an emoji counts once), the unit of the 500 limit.
  codePoints: number;
  bodyIssue: ComposerBodyIssue;
  replyLabel: string | null;
  onCancelReply: () => void;
};

// No maxLength: it counts UTF-16 units and would cut emoji before 500 code points.
export function CommentComposer({
  value, onChangeText, editable, canSend, onSend, codePoints, bodyIssue, replyLabel, onCancelReply,
}: CommentComposerProps) {
  const theme = useTheme();
  const counterColor = bodyIssue === null ? theme.textSecondary : ERROR_COLOR;

  return (
    <View style={[styles.composer, { backgroundColor: theme.background, borderTopColor: theme.backgroundElement }]}>
      {replyLabel !== null ? (
        <View style={styles.replyBar}>
          <Text numberOfLines={1} style={[styles.replyText, { color: theme.textSecondary }]}>
            Respondiendo a {replyLabel}
          </Text>
          <Pressable
            accessibilityLabel="Cancelar respuesta"
            accessibilityRole="button"
            hitSlop={HIT_SLOP}
            onPress={onCancelReply}
            style={({ pressed }) => [styles.cancel, pressed ? styles.pressed : undefined]}>
            <Text style={[styles.cancelText, { color: theme.text }]}>×</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.inputRow}>
        <TextInput
          accessibilityLabel={replyLabel === null ? 'Escribe un comentario' : `Escribe una respuesta a ${replyLabel}`}
          editable={editable}
          multiline
          onChangeText={onChangeText}
          placeholder={editable ? 'Agrega un comentario…' : 'Cargando tus comentarios…'}
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
          value={value}
        />
        <Pressable
          accessibilityLabel="Enviar comentario"
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          hitSlop={HIT_SLOP}
          onPress={onSend}
          style={({ pressed }) => [styles.send, !canSend ? styles.disabled : undefined,
            pressed ? styles.pressed : undefined]}>
          <Text style={[styles.sendText, { color: theme.text }]}>Enviar</Text>
        </Pressable>
      </View>
      <Text accessibilityLiveRegion="polite" style={[styles.counter, { color: counterColor }]}>
        {bodyIssue === 'invalid' ? 'El texto contiene caracteres no válidos · ' : ''}
        {codePoints}/{MAX_POST_COMMENT_BODY_CODE_POINTS}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  composer: { borderTopWidth: StyleSheet.hairlineWidth, gap: 4, paddingHorizontal: 12, paddingVertical: 8 },
  replyBar: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 32 },
  replyText: { flex: 1, fontSize: 13, lineHeight: 18 },
  cancel: { alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 44 },
  cancelText: { fontSize: 22, lineHeight: 26 },
  inputRow: { alignItems: 'flex-end', flexDirection: 'row', gap: 8 },
  input: {
    borderRadius: 18, flex: 1, fontSize: 15, maxHeight: 120, minHeight: 44,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  send: { alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingHorizontal: 12 },
  sendText: { fontSize: 15, fontWeight: '700' },
  counter: { alignSelf: 'flex-end', fontSize: 11, lineHeight: 14 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
});
