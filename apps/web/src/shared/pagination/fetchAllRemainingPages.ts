export interface RemainingPagesResult {
  hasNextPage: boolean;
  isFetchNextPageError: boolean;
}

export async function fetchAllRemainingPages(
  fetchNextPage: () => Promise<RemainingPagesResult>,
): Promise<void> {
  let result = await fetchNextPage();
  while (result.hasNextPage && !result.isFetchNextPageError) {
    result = await fetchNextPage();
  }
}
