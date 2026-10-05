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
  const {
    state, busy, selectImage, removeImage, changeCaption, submit, restart,
  } = useCreatePost(onPublished);
  const disabled = busy || !state.image || state.caption.length > 2200;
  const removeImageDisabled = busy || state.captionLocked;

  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={[styles.screen, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          {state.image ? (
            <View style={styles.previewFrame}>
              <Image accessibilityLabel="Vista previa de la imagen seleccionada"
                source={{ uri: state.image.uri }} resizeMode="cover" style={styles.previewImage} />
              <Pressable
                accessibilityLabel="Quitar imagen seleccionada"
                accessibilityRole="button"
                accessibilityState={{ disabled: removeImageDisabled }}
                disabled={removeImageDisabled}
                hitSlop={8}
                onPress={removeImage}
                style={({ pressed }) => [
                  styles.removeImage,
                  pressed && !removeImageDisabled ? styles.removeImagePressed : undefined,
                  removeImageDisabled ? styles.disabled : undefined,
                ]}>
                <Text style={styles.removeImageText}>×</Text>
              </Pressable>
            </View>
          ) : (
            <View style={[styles.preview, styles.placeholder, { backgroundColor: theme.backgroundElement }]}>
              <Text style={{ color: theme.textSecondary }}>Selecciona una imagen para tu publicación</Text>
            </View>
          )}
          <Pressable accessibilityRole="button" disabled={busy}
            onPress={() => selectImage('original')}
            style={[styles.button, { backgroundColor: theme.backgroundElement }, busy && styles.disabled]}>
            <Text style={[styles.buttonText, { color: theme.text }]}>
              {state.selecting && state.selectionMode === 'original'
                ? 'Seleccionando...'
                : state.image ? 'Elegir otra imagen original' : 'Elegir imagen original'}
            </Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy}
            onPress={() => selectImage('crop-square')}
            style={[styles.button, { backgroundColor: theme.backgroundElement }, busy && styles.disabled]}>
            <Text style={[styles.buttonText, { color: theme.text }]}>
              {state.selecting && state.selectionMode === 'crop-square'
                ? 'Abriendo editor...'
                : state.image ? 'Elegir otra y recortar' : 'Elegir y recortar'}
            </Text>
          </Pressable>
          <Text style={[styles.help, { color: theme.textSecondary }]}>
            La opción de recorte permite ajustar y girar la imagen. En Android se confirma con CROP.
          </Text>
          <Text style={[styles.help, { color: theme.textSecondary }]}>
            La imagen solo se subirá cuando pulses &quot;Subir y publicar&quot;.
          </Text>
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
              {state.retryUpload
                ? 'Reintentar subida'
                : state.error ? 'Reintentar publicación' : 'Subir y publicar'}
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
  previewFrame: { aspectRatio: 1, width: '100%', position: 'relative' },
  preview: { aspectRatio: 1, width: '100%', borderRadius: 12 },
  previewImage: { height: '100%', width: '100%', borderRadius: 12 },
  placeholder: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  removeImage: {
    position: 'absolute', top: 10, right: 10, width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0, 0, 0, 0.68)',
    borderColor: 'rgba(255, 255, 255, 0.72)', borderWidth: StyleSheet.hairlineWidth,
    elevation: 3,
  },
  removeImagePressed: { opacity: 0.72, transform: [{ scale: 0.96 }] },
  removeImageText: { color: '#FFFFFF', fontSize: 27, fontWeight: '300', lineHeight: 29 },
  button: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', padding: 12 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  caption: { minHeight: 120, borderRadius: 12, padding: 16, fontSize: 16, textAlignVertical: 'top' },
  help: { fontSize: 13, lineHeight: 19 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  disabled: { opacity: 0.45 },
});
