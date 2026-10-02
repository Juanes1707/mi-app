import { corsHeaders } from 'npm:@supabase/supabase-js@^2/cors';

const healthPayload = {
  status: 'ok',
  service: 'instagram-mobile-backend',
} as const;

export default {
  fetch: (request: Request): Response => {
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

    return Response.json(
      {
        ...healthPayload,
        timestamp: new Date().toISOString(),
      },
      { headers: corsHeaders },
    );
  },
};
