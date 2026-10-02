import type { AccessTokenProvider } from '@/features/auth/application/ports/access-token-provider';
import { supabase } from '@/infrastructure/supabase/supabase-client';

export class SupabaseAccessTokenProvider implements AccessTokenProvider {
  async getAccessToken(): Promise<string | null> {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      throw new Error(`Unable to retrieve the current access token: ${error.message}`);
    }

    return data.session?.access_token ?? null;
  }
}
