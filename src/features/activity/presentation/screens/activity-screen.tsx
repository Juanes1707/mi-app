import { useFocusEffect, useRouter } from 'expo-router';
import { memo, useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import {
  acceptFollowRequest,
  getPendingFollowRequests,
  rejectFollowRequest,
} from '@/features/activity/activity-container';
import type { PendingFollowRequest } from '@/features/activity/domain/entities/pending-follow-request';
import {
  FollowRequestError,
  type FollowRequestErrorCode,
} from '@/features/activity/domain/errors/follow-request-error';
import type { FollowRequestDecision } from '@/features/activity/domain/models/follow-request';
import { useTheme } from '@/hooks/use-theme';

type ActivityScreenState =
  | { status: 'loading' }
  | { status: 'success'; requests: PendingFollowRequest[] }
  | { status: 'error'; error: FollowRequestError };

type ActionByRequestId = Record<string, FollowRequestDecision | undefined>;
type ErrorByRequestId = Record<string, string | undefined>;

const initialState: ActivityScreenState = { status: 'loading' };
const getRequestKey = (request: PendingFollowRequest) => request.id;

export function ActivityScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [state, setState] = useState<ActivityScreenState>(initialState);
  const [retryVersion, setRetryVersion] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [globalFeedback, setGlobalFeedback] = useState<string | null>(null);
  const [actionByRequestId, setActionByRequestId] = useState<ActionByRequestId>({});
  const [errorByRequestId, setErrorByRequestId] = useState<ErrorByRequestId>({});
  const isFocusedRef = useRef(false);
  const focusGenerationRef = useRef(0);
  const loadGenerationRef = useRef(0);
  const refreshInFlightRef = useRef(false);
  const actionsInFlightRef = useRef(new Set<string>());
  const resolvedRequestIdsRef = useRef(new Set<string>());

  const isCurrentFocus = useCallback(
    (generation: number) =>
      isFocusedRef.current && generation === focusGenerationRef.current,
    [],
  );

  useFocusEffect(
    useCallback(() => {
      const focusGeneration = ++focusGenerationRef.current;
      const loadGeneration = ++loadGenerationRef.current;
      let active = true;

      isFocusedRef.current = true;
      refreshInFlightRef.current = false;
      setState({ status: 'loading' });
      setIsRefreshing(false);
      setRefreshError(null);
      setGlobalFeedback(null);
      setActionByRequestId((current) =>
        keepRecordKeys(current, actionsInFlightRef.current),
      );
      setErrorByRequestId({});

      void getPendingFollowRequests
        .execute()
        .then((requests) => {
          if (
            active &&
            isFocusedRef.current &&
            focusGeneration === focusGenerationRef.current &&
            loadGeneration === loadGenerationRef.current
          ) {
            setState({
              status: 'success',
              requests: withoutResolvedRequests(requests, resolvedRequestIdsRef.current),
            });
          }
        })
        .catch((error: unknown) => {
          if (
            active &&
            isFocusedRef.current &&
            focusGeneration === focusGenerationRef.current &&
            loadGeneration === loadGenerationRef.current
          ) {
            setState({ status: 'error', error: normalizeFollowRequestError(error) });
          }
        });

      return () => {
        active = false;
        isFocusedRef.current = false;
        focusGenerationRef.current += 1;
        loadGenerationRef.current += 1;
        refreshInFlightRef.current = false;
      };
    }, [retryVersion]),
  );

  const retry = () => {
    if (state.status === 'loading') {
      return;
    }

    setState({ status: 'loading' });
    setRetryVersion((current) => current + 1);
  };

  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current || !isFocusedRef.current) {
      return;
    }

    refreshInFlightRef.current = true;
    const focusGeneration = focusGenerationRef.current;
    const loadGeneration = ++loadGenerationRef.current;

    setIsRefreshing(true);
    setRefreshError(null);
    setGlobalFeedback(null);

    try {
      const requests = await getPendingFollowRequests.execute();

      if (
        isCurrentFocus(focusGeneration) &&
        loadGeneration === loadGenerationRef.current
      ) {
        setState({
          status: 'success',
          requests: withoutResolvedRequests(requests, resolvedRequestIdsRef.current),
        });
      }
    } catch (error: unknown) {
      if (
        isCurrentFocus(focusGeneration) &&
        loadGeneration === loadGenerationRef.current
      ) {
        setRefreshError(getLoadErrorMessage(normalizeFollowRequestError(error).code));
      }
    } finally {
      if (
        isCurrentFocus(focusGeneration) &&
        loadGeneration === loadGenerationRef.current
      ) {
        refreshInFlightRef.current = false;
        setIsRefreshing(false);
      }
    }
  }, [isCurrentFocus]);

  const respondToRequest = useCallback(
    async (requestId: string, decision: FollowRequestDecision) => {
      if (actionsInFlightRef.current.has(requestId)) {
        return;
      }

      actionsInFlightRef.current.add(requestId);

      loadGenerationRef.current += 1;
      refreshInFlightRef.current = false;

      if (isFocusedRef.current) {
        setIsRefreshing(false);
        setGlobalFeedback(null);
        setActionByRequestId((current) => ({ ...current, [requestId]: decision }));
        setErrorByRequestId((current) => omitRecordKey(current, requestId));
      }

      try {
        if (decision === 'accept') {
          await acceptFollowRequest.execute(requestId);
        } else {
          await rejectFollowRequest.execute(requestId);
        }

        resolvedRequestIdsRef.current.add(requestId);

        if (isFocusedRef.current) {
          removeRequestFromState(setState, requestId);
        }
      } catch (error: unknown) {
        const followRequestError = normalizeFollowRequestError(error);
        const staleMessage = getStaleRequestMessage(followRequestError.code);

        if (staleMessage) {
          resolvedRequestIdsRef.current.add(requestId);

          if (isFocusedRef.current) {
            removeRequestFromState(setState, requestId);
            setGlobalFeedback(staleMessage);
          }
        } else if (isFocusedRef.current) {
          setErrorByRequestId((current) => ({
            ...current,
            [requestId]: getMutationErrorMessage(followRequestError.code),
          }));
        }
      } finally {
        actionsInFlightRef.current.delete(requestId);

        if (isFocusedRef.current) {
          setActionByRequestId((current) => omitRecordKey(current, requestId));
        }
      }
    },
    [isCurrentFocus],
  );

  const openProfile = useCallback(
    (profileId: string) => {
      router.push({
        pathname: '/activity/profile/[profileId]',
        params: { profileId },
      });
    },
    [router],
  );

  const renderRequest: ListRenderItem<PendingFollowRequest> = useCallback(
    ({ item }) => (
      <FollowRequestItem
        action={actionByRequestId[item.id]}
        errorMessage={errorByRequestId[item.id]}
        onOpenProfile={openProfile}
        onRespond={respondToRequest}
        request={item}
      />
    ),
    [actionByRequestId, errorByRequestId, openProfile, respondToRequest],
  );

  if (state.status === 'loading') {
    return (
      <ActivityStatusLayout>
        <ActivityIndicator accessibilityLabel="Cargando actividad" color={theme.text} size="large" />
        <Text style={[styles.statusTitle, { color: theme.text }]}>Cargando actividad…</Text>
      </ActivityStatusLayout>
    );
  }

  if (state.status === 'error') {
    return (
      <ActivityStatusLayout>
        <Text style={[styles.statusTitle, { color: theme.text }]}>No pudimos cargar tu actividad</Text>
        <Text style={[styles.statusMessage, { color: theme.textSecondary }]}>
          {getLoadErrorMessage(state.error.code)}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={retry}
          style={({ pressed }) => [styles.retryButton, pressed ? styles.pressed : undefined]}>
          <Text style={styles.primaryButtonText}>Reintentar</Text>
        </Pressable>
      </ActivityStatusLayout>
    );
  }

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <FlatList<PendingFollowRequest>
        contentContainerStyle={styles.listContent}
        data={state.requests}
        ItemSeparatorComponent={RequestSeparator}
        keyExtractor={getRequestKey}
        ListEmptyComponent={EmptyActivity}
        ListHeaderComponent={
          <ActivityHeader feedback={globalFeedback} refreshError={refreshError} />
        }
        onRefresh={refresh}
        refreshing={isRefreshing}
        renderItem={renderRequest}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const FollowRequestItem = memo(function FollowRequestItem({
  request,
  action,
  errorMessage,
  onOpenProfile,
  onRespond,
}: {
  request: PendingFollowRequest;
  action: FollowRequestDecision | undefined;
  errorMessage: string | undefined;
  onOpenProfile: (profileId: string) => void;
  onRespond: (requestId: string, decision: FollowRequestDecision) => void;
}) {
  const theme = useTheme();
  const visibleName = getVisibleName(request);
  const username = getVisibleUsername(request);
  const isResponding = action !== undefined;

  return (
    <View style={styles.requestRow}>
      <Pressable
        accessibilityLabel={`Ver perfil de ${visibleName}`}
        accessibilityRole="button"
        disabled={isResponding}
        onPress={() => onOpenProfile(request.requester.id)}
        style={({ pressed }) => [
          styles.profileIdentityButton,
          pressed && !isResponding
            ? { backgroundColor: theme.backgroundElement }
            : undefined,
          isResponding ? styles.disabled : undefined,
        ]}>
        <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
          <Text style={[styles.avatarInitial, { color: theme.text }]}>
            {getAvatarInitial(request)}
          </Text>
        </View>

        <View style={styles.identity}>
          <Text style={[styles.displayName, { color: theme.text }]}>{visibleName}</Text>
          {username ? (
            <Text style={[styles.username, { color: theme.textSecondary }]}>{username}</Text>
          ) : null}
          <Text style={[styles.socialText, { color: theme.textSecondary }]}>Quiere seguirte.</Text>
        </View>
      </Pressable>

      <View style={styles.requestContent}>
        <View style={styles.actions}>
          <Pressable
            accessibilityLabel={`Rechazar solicitud de ${visibleName}`}
            accessibilityRole="button"
            disabled={isResponding}
            onPress={() => onRespond(request.id, 'reject')}
            style={({ pressed }) => [
              styles.actionButton,
              { backgroundColor: theme.backgroundElement },
              pressed && !isResponding ? styles.pressed : undefined,
              isResponding ? styles.disabled : undefined,
            ]}>
            <Text style={[styles.secondaryButtonText, { color: theme.text }]}>
              {action === 'reject' ? 'Rechazando…' : 'Rechazar'}
            </Text>
          </Pressable>

          <Pressable
            accessibilityLabel={`Aceptar solicitud de ${visibleName}`}
            accessibilityRole="button"
            disabled={isResponding}
            onPress={() => onRespond(request.id, 'accept')}
            style={({ pressed }) => [
              styles.actionButton,
              styles.primaryButton,
              pressed && !isResponding ? styles.pressed : undefined,
              isResponding ? styles.disabled : undefined,
            ]}>
            <Text style={styles.primaryButtonText}>
              {action === 'accept' ? 'Aceptando…' : 'Aceptar'}
            </Text>
          </Pressable>
        </View>

        {errorMessage ? (
          <Text accessibilityLiveRegion="polite" style={styles.rowError}>
            {errorMessage}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

function ActivityHeader({
  feedback,
  refreshError,
}: {
  feedback: string | null;
  refreshError: string | null;
}) {
  const theme = useTheme();

  return (
    <View style={[styles.header, { borderBottomColor: theme.backgroundElement }]}>
      <Text style={[styles.screenTitle, { color: theme.text }]}>Actividad</Text>
      <Text style={[styles.screenSubtitle, { color: theme.textSecondary }]}>
        Solicitudes de seguimiento
      </Text>
      {feedback || refreshError ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[
            styles.inlineMessage,
            { backgroundColor: theme.backgroundElement, color: theme.text },
          ]}>
          {feedback ?? refreshError}
        </Text>
      ) : null}
    </View>
  );
}

function EmptyActivity() {
  const theme = useTheme();

  return (
    <View style={styles.emptyState}>
      <Text style={[styles.emptyTitle, { color: theme.text }]}>No tienes solicitudes pendientes.</Text>
      <Text style={[styles.emptyMessage, { color: theme.textSecondary }]}>
        Las nuevas solicitudes aparecerán aquí.
      </Text>
    </View>
  );
}

function RequestSeparator() {
  const theme = useTheme();

  return <View style={[styles.separator, { backgroundColor: theme.backgroundElement }]} />;
}

function ActivityStatusLayout({ children }: { children: React.ReactNode }) {
  const theme = useTheme();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View style={styles.statusContent}>{children}</View>
    </SafeAreaView>
  );
}

function removeRequestFromState(
  setState: React.Dispatch<React.SetStateAction<ActivityScreenState>>,
  requestId: string,
) {
  setState((current) =>
    current.status === 'success'
      ? {
          status: 'success',
          requests: current.requests.filter((request) => request.id !== requestId),
        }
      : current,
  );
}

function withoutResolvedRequests(
  requests: PendingFollowRequest[],
  resolvedRequestIds: Set<string>,
): PendingFollowRequest[] {
  return requests.filter((request) => !resolvedRequestIds.has(request.id));
}

function omitRecordKey<T>(
  record: Record<string, T | undefined>,
  key: string,
): Record<string, T | undefined> {
  const next = { ...record };
  delete next[key];
  return next;
}

function keepRecordKeys<T>(
  record: Record<string, T | undefined>,
  keys: Set<string>,
): Record<string, T | undefined> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => keys.has(key)),
  );
}

function normalizeFollowRequestError(error: unknown): FollowRequestError {
  return error instanceof FollowRequestError ? error : new FollowRequestError('unavailable');
}

function getLoadErrorMessage(code: FollowRequestErrorCode): string {
  if (code === 'authentication-required') {
    return 'Tu sesión no está disponible.';
  }

  if (code === 'invalid-response') {
    return 'No pudimos interpretar la actividad recibida.';
  }

  return 'No pudimos cargar tu actividad. Revisa tu conexión e inténtalo de nuevo.';
}

function getMutationErrorMessage(code: FollowRequestErrorCode): string {
  if (code === 'authentication-required') {
    return 'Tu sesión no está disponible.';
  }

  if (code === 'invalid-request') {
    return 'No pudimos procesar esta solicitud.';
  }

  if (code === 'invalid-response') {
    return 'Recibimos una respuesta inesperada del servidor.';
  }

  return 'No pudimos responder. Inténtalo de nuevo.';
}

function getStaleRequestMessage(code: FollowRequestErrorCode): string | null {
  if (code === 'already-resolved') {
    return 'Esta solicitud ya había sido respondida.';
  }

  if (code === 'request-not-found') {
    return 'Esta solicitud ya no está disponible.';
  }

  return null;
}

function getVisibleName(request: PendingFollowRequest): string {
  return request.requester.displayName?.trim() || request.requester.username?.trim() || 'Usuario';
}

function getVisibleUsername(request: PendingFollowRequest): string | null {
  const username = request.requester.username?.trim();
  return username ? `@${username}` : null;
}

function getAvatarInitial(request: PendingFollowRequest): string {
  const source = request.requester.displayName?.trim() || request.requester.username?.trim();
  return source ? Array.from(source)[0].toLocaleUpperCase() : '?';
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  listContent: {
    alignSelf: 'center',
    flexGrow: 1,
    maxWidth: MaxContentWidth,
    paddingBottom: BottomTabInset + Spacing.five,
    width: '100%',
  },
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.one,
    paddingBottom: 14,
    paddingHorizontal: Spacing.three,
    paddingTop: Platform.select({ web: 82, default: 10 }),
  },
  screenTitle: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.6,
    lineHeight: 32,
  },
  screenSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  inlineMessage: {
    borderRadius: 10,
    fontSize: 13,
    lineHeight: 18,
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  requestRow: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  profileIdentityButton: {
    alignItems: 'flex-start',
    borderRadius: 12,
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.one,
  },
  avatar: {
    alignItems: 'center',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  avatarInitial: {
    fontSize: 19,
    fontWeight: '700',
    lineHeight: 24,
  },
  requestContent: {
    gap: Spacing.three,
    marginLeft: 68,
    minWidth: 0,
  },
  identity: {
    flex: 1,
    gap: Spacing.half,
    minWidth: 0,
  },
  displayName: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 21,
  },
  username: {
    fontSize: 13,
    lineHeight: 18,
  },
  socialText: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: Spacing.one,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  actionButton: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 104,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  primaryButton: {
    backgroundColor: '#208AEF',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  rowError: {
    color: '#C62828',
    fontSize: 13,
    lineHeight: 18,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 80,
  },
  emptyState: {
    alignItems: 'center',
    flex: 1,
    gap: Spacing.two,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.six,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
    textAlign: 'center',
  },
  emptyMessage: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  statusContent: {
    alignItems: 'center',
    flex: 1,
    gap: Spacing.three,
    justifyContent: 'center',
    paddingBottom: BottomTabInset,
    paddingHorizontal: Spacing.four,
    paddingTop: Platform.select({ web: 82, default: 0 }),
  },
  statusTitle: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 26,
    textAlign: 'center',
  },
  statusMessage: {
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 360,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#208AEF',
    borderRadius: 12,
    justifyContent: 'center',
    marginTop: Spacing.one,
    minHeight: 48,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  pressed: {
    opacity: 0.82,
  },
  disabled: {
    opacity: 0.62,
  },
});
