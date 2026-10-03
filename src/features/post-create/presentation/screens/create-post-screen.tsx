import {
  ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTabInset, MaxContentWidth } from '@/constants/theme';
import type { PublishedPost } from '@/features/post-create/domain/models';
import type { PostCreateErrorCode } from '@/features/post-create/domain/post-create-error';
import { useCreatePost } from '@/features/post-create/presentation/hooks/use-create-post';
import { useTheme } from '@/hooks/use-theme';

const messages: Record<PostCreateErrorCode, string> = {
  'authentication-required': 'Tu sesión no está disponible.',
  'invalid-image': 'Selecciona una imagen JPG, PNG o WEBP que esté disponible en tu dispositivo.',
  'image-too-large': 'La imagen no puede superar 10 MB.',
  'invalid-caption': 'El texto de la publicación no es válido.',
  'upload-unavailable': 'No pudimos subir la imagen. Inténtalo nuevamente.',
  'media-not-ready': 'La imagen todavía no está lista para publicarse.',
  'profile-not-ready': 'Tu perfil todavía no está listo para publicar.',
  'invalid-response': 'Recibimos una respuesta inesperada del servidor.',
  'invalid-request': 'No pudimos utilizar la imagen o el texto de la publicación.',
  unavailable: 'No pudimos publicar en este momento.',
};
const progress: Record<string, string> = {
  preparing: 'Preparando subida...',
  uploading: 'Subiendo imagen...',
  publishing: 'Publicando...',
  success: 'Publicación creada.',
};

export function CreatePostScreen({ onPublished }: { onPublished: (post: PublishedPost) => void }) {
  const theme = useTheme();
  const { state, busy, selectImage, changeCaption, submit, restart } = useCreatePost(onPublished);
  const disabled = busy || !state.image || state.caption.length > 2200;

  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={[styles.screen, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          {state.image ? (
            <Image accessibilityLabel="Vista previa de la imagen seleccionada"
              source={{ uri: state.image.uri }} resizeMode="cover" style={styles.preview} />
          ) : (
            <View style={[styles.preview, styles.placeholder, { backgroundColor: theme.backgroundElement }]}>
              <Text style={{ color: theme.textSecondary }}>Selecciona una imagen para tu publicación</Text>
            </View>
          )}
          <Pressable accessibilityRole="button" disabled={busy} onPress={selectImage}
            style={[styles.button, { backgroundColor: theme.backgroundElement }, busy && styles.disabled]}>
            <Text style={[styles.buttonText, { color: theme.text }]}>
              {state.selecting ? 'Seleccionando...' : state.image ? 'Cambiar imagen' : 'Seleccionar imagen'}
            </Text>
          </Pressable>
          <TextInput accessibilityLabel="Texto de la publicación" multiline maxLength={2200}
            editable={!busy && !state.captionLocked} value={state.caption} onChangeText={changeCaption}
            placeholder="Escribe un texto..." placeholderTextColor={theme.textSecondary}
            style={[styles.caption, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
          <Text style={[styles.help, { color: theme.textSecondary }]}>{state.caption.length} / 2200</Text>
          {state.captionLocked && !busy ? (
            <Text style={[styles.help, { color: theme.textSecondary }]}>
              El reintento conservará la misma imagen y el mismo texto.
            </Text>
          ) : null}
          <View accessibilityLiveRegion="polite">
            {progress[state.phase] ? (
              <View style={styles.progress}>
                {state.phase !== 'success' ? <ActivityIndicator color={theme.text} /> : null}
                <Text style={{ color: theme.text }}>{progress[state.phase]}</Text>
              </View>
            ) : null}
            {state.error ? <Text style={{ color: theme.text }}>{messages[state.error.code]}</Text> : null}
          </View>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled }}
            disabled={disabled} onPress={submit}
            style={[styles.button, { backgroundColor: theme.text }, disabled && styles.disabled]}>
            <Text style={[styles.buttonText, { color: theme.background }]}>
              {state.retryUpload ? 'Reintentar subida' : state.error ? 'Reintentar publicación' : 'Publicar'}
            </Text>
          </Pressable>
          {state.canRestart ? (
            <>
              <Text style={[styles.help, { color: theme.textSecondary }]}>
                La subida sigue sin estar disponible. Puedes solicitar una nueva autorización y comenzar de nuevo.
              </Text>
              <Pressable accessibilityRole="button" disabled={busy} onPress={restart} style={styles.button}>
                <Text style={[styles.buttonText, { color: theme.text }]}>Reintentar desde el inicio</Text>
              </Pressable>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { alignSelf: 'center', width: '100%', maxWidth: MaxContentWidth,
    padding: 20, paddingBottom: BottomTabInset + 24, gap: 16 },
  preview: { aspectRatio: 1, width: '100%', borderRadius: 12 },
  placeholder: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  button: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', padding: 12 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  caption: { minHeight: 120, borderRadius: 12, padding: 16, fontSize: 16, textAlignVertical: 'top' },
  help: { fontSize: 13, lineHeight: 19 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  disabled: { opacity: 0.45 },
});
