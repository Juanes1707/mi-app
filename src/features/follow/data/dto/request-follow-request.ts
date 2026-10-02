export type RequestFollowRequestDto = {
  targetProfileId: string;
};

export function mapRequestFollowToRequestDto(
  targetProfileId: string,
): RequestFollowRequestDto {
  return { targetProfileId };
}
