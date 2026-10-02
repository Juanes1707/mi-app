import { createClient } from 'npm:@supabase/supabase-js@^2';
import { corsHeaders } from 'npm:@supabase/supabase-js@^2/cors';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase authentication configuration is unavailable.');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

function unauthorizedResponse(): Response {
  return Response.json(
    { error: 'Unauthorized' },
    {
      status: 401,
      headers: corsHeaders,
    },
  );
}

export default {
  fetch: async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    if (request.method !== 'GET') {
      return Response.json(
        { error: 'Method not allowed' },
        {
          status: 405,
          headers: {
            ...corsHeaders,
            Allow: 'GET, OPTIONS',
          },
        },
      );
    }

    const authorization = request.headers.get('Authorization');

    if (!authorization?.startsWith('Bearer ')) {
      return unauthorizedResponse();
    }

    const accessToken = authorization.slice('Bearer '.length).trim();

    if (!accessToken) {
      return unauthorizedResponse();
    }

    const { data, error } = await supabase.auth.getClaims(accessToken);
    const userId = data?.claims.sub;

    if (error || !userId) {
      return unauthorizedResponse();
    }

    return Response.json(
      {
        authenticated: true,
        userId,
      },
      { headers: corsHeaders },
    );
  },
};
