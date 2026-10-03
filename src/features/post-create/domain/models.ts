export type PostImageContentType = 'image/jpeg' | 'image/png' | 'image/webp';
export type LocalPostImage = { uri: string; contentType: PostImageContentType; fileSize: number };
export type PostMediaUploadTicket = { bucket: 'post-media'; path: string; token: string };
export type PublishedPost = {
  id: string;
  authorId: string;
  imagePath: string;
  caption: string;
  createdAt: string;
};
export type PostMediaInput = Pick<LocalPostImage, 'contentType' | 'fileSize'>;
export type PublishPostInput = { imagePath: string; caption: string };
