import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform, type NativeEventSubscription } from 'react-native';

function getSupabaseConfig() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    const missingVariables: string[] = [];

    if (!url) {
      missingVariables.push('EXPO_PUBLIC_SUPABASE_URL');
    }

    if (!publishableKey) {
      missingVariables.push('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
    }

    throw new Error(
      `Supabase configuration is missing: ${missingVariables.join(', ')}. ` +
        'Copy .env.example to .env and complete the required variables.',
    );
  }

  return { publishableKey, url };
}

const { publishableKey, url } = getSupabaseConfig();

export const supabase = createClient(url, publishableKey, {
  auth: {
    ...(Platform.OS !== 'web' ? { storage: AsyncStorage } : {}),
    autoRefreshToken: true,
    detectSessionInUrl: false,
    persistSession: true,
  },
});

type SupabaseRuntime = typeof globalThis & {
  __instagramMovilSupabaseAuthAppStateSubscription?: NativeEventSubscription;
};

const runtime = globalThis as SupabaseRuntime;

if (Platform.OS !== 'web' && !runtime.__instagramMovilSupabaseAuthAppStateSubscription) {
  runtime.__instagramMovilSupabaseAuthAppStateSubscription = AppState.addEventListener(
    'change',
    (state) => {
      if (state === 'active') {
        supabase.auth.startAutoRefresh();
      } else {
        supabase.auth.stopAutoRefresh();
      }
    },
  );
}
