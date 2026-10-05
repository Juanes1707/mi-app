import { isRunningInExpoGo } from 'expo';
import { createURL } from 'expo-linking';

// Inside Expo Go the app is reached through the current dev server (LAN or tunnel,
// whose address changes between sessions): exp://<host>/--/post/{uuid}. In an
// installed build there is nothing to add: the backend redirects to the app scheme.
export function expoGoPostAppUrl(postId: string): string | null {
  return isRunningInExpoGo() ? createURL(`post/${postId}`) : null;
}
