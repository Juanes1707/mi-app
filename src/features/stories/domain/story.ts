export type StoryImageContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export type StoryAuthor = { id: string; username: string | null; displayName: string | null };

// One Home tray entry: the actor (isSelf) or an account the actor follows, with at
// least one active Story. Ordered isSelf DESC, latestStoryCreatedAt DESC, author id DESC.
export type StoryTray = {
  author: StoryAuthor;
  latestStoryCreatedAt: string;
  activeStoryCount: number;
  isSelf: boolean;
};
export type StoryTrayCursor = { isSelf: boolean; latestStoryCreatedAt: string; authorId: string };
export type StoryTrayPage = { trays: StoryTray[]; nextCursor: StoryTrayCursor | null };

// imagePath is the stable media identity; a signed URL is only a short-lived capability.
export type Story = {
  id: string;
  author: StoryAuthor;
  imagePath: string;
  createdAt: string;
  expiresAt: string;
};
export type StoriesCursor = { createdAt: string; storyId: string };
export type StoriesPage = { stories: Story[]; nextCursor: StoriesCursor | null };

export type StoryImageInput = { contentType: StoryImageContentType; sizeBytes: number };
export type LocalStoryImage = StoryImageInput & { uri: string };
export type StoryUploadTicket = { storyId: string; bucket: 'story-media'; path: string; token: string };
export type PublishedStory = {
  id: string;
  authorId: string;
  imagePath: string;
  createdAt: string;
  expiresAt: string;
};
export type StoryMediaAccess = {
  storyId: string;
  imagePath: string;
  signedUrl: string;
  expiresInSeconds: number;
};
