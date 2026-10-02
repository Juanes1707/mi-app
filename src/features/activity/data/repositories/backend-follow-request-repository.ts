import { isFollowRequestsResponseDto } from '@/features/activity/data/dto/follow-requests-response';
import {
  mapRespondFollowRequestToRequestDto,
  type RespondFollowRequestRequestDto,
} from '@/features/activity/data/dto/respond-follow-request-request';
import { isRespondFollowRequestResponseDto } from '@/features/activity/data/dto/respond-follow-request-response';
import { mapFollowRequestDtoToDomain } from '@/features/activity/data/mappers/follow-request-mapper';
import type { PendingFollowRequest } from '@/features/activity/domain/entities/pending-follow-request';
import { FollowRequestError } from '@/features/activity/domain/errors/follow-request-error';
import type {
  FollowRequestDecision,
  FollowRequestResolution,
} from '@/features/activity/domain/models/follow-request';
import type { FollowRequestRepository } from '@/features/activity/domain/repositories/follow-request-repository';
import {
  AuthenticatedBackendApiClient,
  AuthenticationRequiredError,
} from '@/infrastructure/api/authenticated-backend-api-client';
import { BackendApiError } from '@/infrastructure/api/backend-api-client';

export class BackendFollowRequestRepository implements FollowRequestRepository {
  constructor(private readonly authenticatedBackendApiClient: AuthenticatedBackendApiClient) {}

  async getPendingFollowRequests(): Promise<PendingFollowRequest[]> {
    try {
      const response = await this.authenticatedBackendApiClient.get<unknown>(
        '/follow-requests',
      );

      if (!isFollowRequestsResponseDto(response)) {
        throw new FollowRequestError('invalid-response');
      }

      return response.requests.map(mapFollowRequestDtoToDomain);
    } catch (error: unknown) {
      throw this.mapError(error);
    }
  }

  async respondToFollowRequest(
    requestId: string,
    decision: FollowRequestDecision,
  ): Promise<FollowRequestResolution> {
    try {
      const request = mapRespondFollowRequestToRequestDto(requestId, decision);
      const response = await this.authenticatedBackendApiClient.patch<
        unknown,
        RespondFollowRequestRequestDto
      >('/follow-requests', request);

      if (!isRespondFollowRequestResponseDto(response)) {
        throw new FollowRequestError('invalid-response');
      }

      if (
        (decision === 'accept' && response.status !== 'accepted') ||
        (decision === 'reject' && response.status !== 'rejected')
      ) {
        throw new FollowRequestError('invalid-response');
      }

      return response.status;
    } catch (error: unknown) {
      throw this.mapError(error);
    }
  }

  private mapError(error: unknown): FollowRequestError {
    if (error instanceof FollowRequestError) {
      return error;
    }

    if (error instanceof AuthenticationRequiredError) {
      return new FollowRequestError('authentication-required');
    }

    if (error instanceof BackendApiError) {
      if (error.code === 'invalid-json') {
        return new FollowRequestError('invalid-response');
      }

      if (error.status === 401) {
        return new FollowRequestError('authentication-required');
      }

      if (
        error.status === 404 ||
        error.backendCode === 'follow_request_not_found'
      ) {
        return new FollowRequestError('request-not-found');
      }

      if (
        error.status === 409 ||
        error.backendCode === 'follow_request_already_resolved'
      ) {
        return new FollowRequestError('already-resolved');
      }

      if (
        error.status === 400 ||
        (error.backendCode !== undefined &&
          INVALID_REQUEST_CODES.has(error.backendCode))
      ) {
        return new FollowRequestError('invalid-request');
      }
    }

    return new FollowRequestError('unavailable');
  }
}

const INVALID_REQUEST_CODES = new Set([
  'invalid_json',
  'invalid_follow_request_response',
  'invalid_follow_request_decision',
]);
