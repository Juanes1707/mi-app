import {
  parsePublishedStory, parseStoriesPage, parseStoryMediaAccess, parseStoryTrayPage, parseStoryUploadTicket,
} from '@/features/stories/data/stories-response';
import type {
  PublishedStory, StoriesCursor, StoriesPage, StoryImageInput, StoryMediaAccess,
  StoryTrayCursor, StoryTrayPage, StoryUploadTicket,
} from '@/features/stories/domain/story';
import { StoriesError } from '@/features/stories/domain/stories-error';
import type { StoriesRepository } from '@/features/stories/domain/stories-repository';
import {
  AuthenticatedBackendApiClient, AuthenticatedUserMismatchError, AuthenticationRequiredError,
} from '@/infrastructure/api/authenticated-backend-api-client';
import { BackendApiError } from '@/infrastructure/api/backend-api-client';

type Endpoint = 'trays' | 'stories' | 'prepare' | 'publish' | 'media';

// Business reads/writes and capability acquisition go through the owner-bound backend
// client (Edge -> one RPC); this class never touches Supabase tables or Storage.
export class BackendStoriesRepository implements StoriesRepository {
  constructor(private readonly client: AuthenticatedBackendApiClient) {}

  async getTrayPage(owner: string, limit: number, cursor: StoryTrayCursor | null): Promise<StoryTrayPage> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) {
      params.set('beforeIsSelf', String(cursor.isSelf));
      params.set('beforeLatestStoryCreatedAt', cursor.latestStoryCreatedAt);
      params.set('beforeAuthorId', cursor.authorId);
    }
    let response: unknown;
    try { response = await this.client.getAsUser<unknown>(owner, `/story-trays?${params}`); }
    catch (error: unknown) { throw mapError(error, 'trays'); }
    const page = parseStoryTrayPage(response, { ownerUserId: owner, limit, cursor });
    if (page === null) throw new StoriesError('invalid-response');
    return page;
  }

  async getStoriesPage(owner: string, authorId: string, limit: number, cursor: StoriesCursor | null): Promise<StoriesPage> {
    const params = new URLSearchParams({ authorId, limit: String(limit) });
    if (cursor) {
      params.set('afterCreatedAt', cursor.createdAt);
      params.set('afterStoryId', cursor.storyId);
    }
    let response: unknown;
    try { response = await this.client.getAsUser<unknown>(owner, `/stories?${params}`); }
    catch (error: unknown) { throw mapError(error, 'stories'); }
    const page = parseStoriesPage(response, { authorId, limit, cursor });
    if (page === null) throw new StoriesError('invalid-response');
    return page;
  }

  async prepareStoryImageUpload(owner: string, storyId: string, image: StoryImageInput): Promise<StoryUploadTicket> {
    let response: unknown;
    try {
      response = await this.client.postAsUser<unknown, { storyId: string; contentType: string; sizeBytes: number }>(
        owner, '/story-media', { storyId, contentType: image.contentType, sizeBytes: image.sizeBytes },
      );
    } catch (error: unknown) { throw mapError(error, 'prepare'); }
    const ticket = parseStoryUploadTicket(response, { ownerUserId: owner, storyId, contentType: image.contentType });
    if (ticket === null) throw new StoriesError('invalid-response');
    return ticket;
  }

  async publishStory(owner: string, storyId: string, imagePath: string): Promise<PublishedStory> {
    let response: unknown;
    try {
      response = await this.client.postAsUser<unknown, { storyId: string; imagePath: string }>(
        owner, '/stories', { storyId, imagePath },
      );
    } catch (error: unknown) { throw mapError(error, 'publish'); }
    const story = parsePublishedStory(response, { ownerUserId: owner, storyId, imagePath });
    if (story === null) throw new StoriesError('invalid-response');
    return story;
  }

  async getStoryMediaAccess(owner: string, storyId: string): Promise<StoryMediaAccess> {
    let response: unknown;
    try {
      response = await this.client.getAsUser<unknown>(owner, `/story-media?${new URLSearchParams({ storyId })}`);
    } catch (error: unknown) { throw mapError(error, 'media'); }
    const access = parseStoryMediaAccess(response, storyId);
    if (access === null) throw new StoriesError('invalid-response');
    return access;
  }
}

const INVALID_REQUEST_CODES: Record<Endpoint, string> = {
  trays: 'invalid_story_trays_request',
  stories: 'invalid_stories_request',
  prepare: 'invalid_story_media_request',
  publish: 'invalid_story_publish_request',
  media: 'invalid_story_media_read_request',
};

// Raw HTTP never leaves the data layer: every failure becomes a StoriesError.
function mapError(error: unknown, endpoint: Endpoint): StoriesError {
  if (error instanceof AuthenticatedUserMismatchError) return new StoriesError('owner-session-mismatch');
  if (error instanceof AuthenticationRequiredError) return new StoriesError('authentication-required');
  if (!(error instanceof BackendApiError)) return new StoriesError('unavailable');
  if (error.code === 'invalid-json') return new StoriesError('invalid-response');
  if (error.code !== 'http') return new StoriesError('unavailable');
  if (error.status === 401) return new StoriesError('authentication-required');
  if (error.status === 400 && error.backendCode === INVALID_REQUEST_CODES[endpoint]) {
    return new StoriesError('invalid-request');
  }
  if (error.status === 409 && error.backendCode === 'profile_not_ready') return new StoriesError('profile-not-ready');
  if (endpoint === 'stories' && error.status === 404 && error.backendCode === 'author_not_found') {
    return new StoriesError('author-not-found');
  }
  if (endpoint === 'media' && error.status === 404 && error.backendCode === 'story_not_found') {
    return new StoriesError('story-not-found');
  }
  if ((endpoint === 'prepare' || endpoint === 'publish') && error.status === 409 &&
      error.backendCode === 'story_id_conflict') return new StoriesError('story-id-conflict');
  if (endpoint === 'publish' && error.status === 409 && error.backendCode === 'story_media_not_ready') {
    return new StoriesError('media-not-ready');
  }
  return new StoriesError('unavailable');
}
