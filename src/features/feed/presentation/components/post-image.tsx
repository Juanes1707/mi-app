import { Image, StyleSheet, View } from 'react-native';

type PostImageProps = {
  imageUrl: string;
  accessibilityLabel: string;
};

export function PostImage({ imageUrl, accessibilityLabel }: PostImageProps) {
  return (
    <View style={styles.container}>
      <Image
        accessibilityLabel={accessibilityLabel}
        resizeMode="cover"
        source={{ uri: imageUrl }}
        style={styles.image}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    aspectRatio: 1,
    backgroundColor: '#D9DDE3',
    overflow: 'hidden',
    width: '100%',
  },
  image: {
    height: '100%',
    width: '100%',
  },
});
