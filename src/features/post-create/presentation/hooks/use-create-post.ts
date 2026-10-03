import { useCallback, useEffect, useRef, useState } from 'react';

import type { LocalPostImage, PostMediaUploadTicket, PublishedPost } from '@/features/post-create/domain/models';
import { PostCreateError } from '@/features/post-create/domain/post-create-error';
import {
  preparePostMediaUpload, publishPost, selectPostImage, uploadPostMedia,
} from '@/features/post-create/post-create-container';

type Phase = 'idle' | 'ready' | 'preparing' | 'uploading' | 'publishing' | 'error' | 'success';
type State = {
  image: LocalPostImage | null;
  caption: string;
  phase: Phase;
  selecting: boolean;
  error: PostCreateError | null;
  captionLocked: boolean;
  retryUpload: boolean;
  canRestart: boolean;
};
type Attempt = {
  ticket: PostMediaUploadTicket | null;
  uploadedImagePath: string | null;
  caption: string | null;
  retryPublish: boolean;
  uploadFailures: number;
};
const emptyAttempt = (): Attempt => ({
  ticket: null, uploadedImagePath: null, caption: null, retryPublish: false, uploadFailures: 0,
});
const initialState: State = {
  image: null, caption: '', phase: 'idle', selecting: false, error: null,
  captionLocked: false, retryUpload: false, canRestart: false,
};

export function useCreatePost(onPublished: (post: PublishedPost) => void) {
  const [state, setState] = useState<State>(initialState);
  const stateRef = useRef(state);
  const attemptRef = useRef<Attempt>(emptyAttempt());
  const busyRef = useRef(false);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);

  const update = useCallback((patch: Partial<State>) => {
    const next = { ...stateRef.current, ...patch };
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  const selectImage = useCallback(async () => {
    if (busyRef.current || !mountedRef.current) return;
    busyRef.current = true;
    const generation = ++generationRef.current;
    update({ selecting: true });
    try {
      const image = await selectPostImage.execute();
      if (!mountedRef.current || generation !== generationRef.current) return;
      if (image) {
        attemptRef.current = emptyAttempt();
        update({ image, phase: 'ready', error: null, captionLocked: false,
          retryUpload: false, canRestart: false });
      }
    } catch (error: unknown) {
      if (mountedRef.current && generation === generationRef.current) {
        update({ error: asPostError(error), phase: 'error' });
      }
    } finally {
      if (mountedRef.current && generation === generationRef.current) {
        busyRef.current = false;
        update({ selecting: false });
      }
    }
  }, [update]);

  const changeCaption = useCallback((caption: string) => {
    if (busyRef.current || stateRef.current.captionLocked) return;
    update({ caption, error: null,
      phase: stateRef.current.image ? 'ready' : 'idle' });
  }, [update]);

  const submit = useCallback(async () => {
    const image = stateRef.current.image;
    if (busyRef.current || !mountedRef.current || !image) return;
    busyRef.current = true;
    const generation = ++generationRef.current;
    const attempt = attemptRef.current;
    const isCurrent = () => mountedRef.current && generation === generationRef.current;
    let published: PublishedPost | null = null;
    try {
      // Keep the same text as well as the same path after an uncertain POST.
      if (attempt.caption === null) attempt.caption = stateRef.current.caption;
      if (attempt.caption.length > 2200) throw new PostCreateError('invalid-caption');
      update({ error: null, canRestart: false, retryUpload: false });
      if (!attempt.ticket) {
        update({ phase: 'preparing', captionLocked: true });
        const ticket = await preparePostMediaUpload.execute({
          contentType: image.contentType, fileSize: image.fileSize,
        });
        if (!isCurrent()) return;
        attempt.ticket = ticket;
      }
      if (!attempt.uploadedImagePath && !attempt.retryPublish) {
        update({ phase: 'uploading' });
        try {
          await uploadPostMedia.execute(image, attempt.ticket);
          if (!isCurrent()) return;
          attempt.uploadedImagePath = attempt.ticket.path;
        } catch (error: unknown) {
          if (!isCurrent()) return;
          if (!(error instanceof PostCreateError) || error.code !== 'upload-unavailable') throw error;
          attempt.uploadFailures += 1;
          // A failed transport may already have stored the object. Reconcile once below.
        }
      }
      if (!isCurrent()) return;
      attempt.retryPublish = true;
      update({ phase: 'publishing' });
      published = await publishPost.execute({
        imagePath: attempt.uploadedImagePath ?? attempt.ticket.path,
        caption: attempt.caption,
      });
      if (!isCurrent()) return;
      update({ phase: 'success', error: null });
    } catch (error: unknown) {
      if (!isCurrent()) return;
      const failure = asPostError(error);
      if (failure.code === 'media-not-ready' && !attempt.uploadedImagePath) {
        attempt.retryPublish = false;
      }
      if (!attempt.ticket) attempt.caption = null;
      update({
        phase: 'error', error: failure, captionLocked: attempt.ticket !== null,
        retryUpload: !!attempt.ticket && !attempt.uploadedImagePath && !attempt.retryPublish,
        canRestart: !attempt.uploadedImagePath && failure.code === 'media-not-ready' &&
          attempt.uploadFailures >= 2,
      });
    } finally {
      if (isCurrent() && !published) busyRef.current = false;
    }
    if (published && isCurrent()) onPublished(published);
  }, [onPublished, update]);

  const restart = useCallback(() => {
    if (busyRef.current || !stateRef.current.canRestart || !mountedRef.current) return;
    generationRef.current += 1;
    attemptRef.current = emptyAttempt();
    update({ phase: 'ready', error: null, captionLocked: false, retryUpload: false, canRestart: false });
  }, [update]);

  const busy = state.selecting || ['preparing', 'uploading', 'publishing', 'success'].includes(state.phase);
  return { state, busy, selectImage, changeCaption, submit, restart };
}

function asPostError(error: unknown): PostCreateError {
  return error instanceof PostCreateError ? error : new PostCreateError('unavailable');
}
