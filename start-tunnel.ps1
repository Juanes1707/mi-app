# Use Expo's account-backed tunnel. Expo SDK 57 includes this path, which avoids
# the legacy ngrok agent bundled by @expo/ngrok.
$env:EXPO_UNSTABLE_TUNNEL_V2 = '1'
npx expo start --tunnel
