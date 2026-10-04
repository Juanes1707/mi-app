import { withSupabase } from 'npm:@supabase/server@1';

import {
  handleProfileConnectionsRequest,
} from '../_shared/profile-connections.ts';

export default {
  fetch: withSupabase({ auth: 'user' }, (request, context) =>
    handleProfileConnectionsRequest(
      request,
      context.userClaims?.id,
      (name, args) => context.supabaseAdmin.rpc(name, args),
    )),
};
