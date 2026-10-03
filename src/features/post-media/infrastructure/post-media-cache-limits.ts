// Level 1 budget: estimated decoded bitmap bytes retained BY THE CACHE.
// Bitmaps held by currently visible cells are dropped from their state when they leave the viewport.
export const POST_MEDIA_MEMORY_BUDGET_BYTES = 32 * 1024 * 1024;

// Level 2 budget: encoded file bytes stored on disk.
export const POST_MEDIA_DISK_BUDGET_BYTES = 128 * 1024 * 1024;

// Same ceiling the backend enforces for `post-media` objects.
export const POST_MEDIA_MAX_FILE_BYTES = 10 * 1024 * 1024;

// Decode never materializes more than 1440 px on the longest edge in RAM.
export const MAX_DECODED_EDGE_PX = 1440;

// Versioned so an incompatible layout can be discarded wholesale.
export const POST_MEDIA_DISK_DIRECTORY = 'post-media-v1';
