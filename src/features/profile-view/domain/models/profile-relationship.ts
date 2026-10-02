export type ProfileRelationship =
  | {
      status: 'none';
    }
  | {
      status: 'following';
    }
  | {
      status: 'request-pending';
      requestId: string;
    };
