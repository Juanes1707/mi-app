export function shouldCatchUpRealtimeRoot(
  subscriptionVersion: number,
  handledSubscriptionVersion: number,
  rootIsLoaded: boolean,
): boolean {
  return rootIsLoaded && subscriptionVersion > handledSubscriptionVersion;
}
