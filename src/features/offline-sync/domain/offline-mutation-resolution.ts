import { CREATE_POST_COMMENT, SET_POST_LIKE } from './offline-mutation';

// How one queued mutation was resolved, recorded only once its SQLite row was
// actually removed. Leaving the queue is not the same as succeeding: a terminal
// "not found" also finishes the entry. No payload, body or credentials: only the
// identity of the entry and the authoritative remote outcome.
export type CompletedOfflineMutation =
  | {
      sequence: number;
      ownerUserId: string;
      kind: typeof SET_POST_LIKE;
      entityKey: string;
      // confirmed: 200 with the desired state. not-found: contractual 404 post_not_found.
      outcome: 'confirmed' | 'not-found';
    }
  | {
      sequence: number;
      ownerUserId: string;
      kind: typeof CREATE_POST_COMMENT;
      entityKey: string;
      // confirmed: 201 created or 200 exact replay. The 404s are terminal: the comment
      // can no longer be applied by this actor (it may still exist if an earlier
      // response was lost and visibility changed afterwards).
      outcome: 'confirmed' | 'post-not-found' | 'parent-not-found';
    };
