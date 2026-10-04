import { useAuth } from '@/features/auth/presentation/hooks/use-auth';
import { useDirectInboxRealtime } from '@/features/direct-messages/presentation/hooks/use-direct-inbox-realtime';

// Mounted once below AuthProvider (like the offline sync host) so messages can become
// "Entregado" whatever screen is open: Feed, Profile, Explore, Inbox or Chat.
export function DirectMessageRealtimeHost() {
  const { user } = useAuth();
  useDirectInboxRealtime(user ? user.id.toLowerCase() : null);
  return null;
}
