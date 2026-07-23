import { MAIN_LIST_PAGE_SIZE } from '@causality/contracts';

export interface CountRow {
  total: number;
}

export function resolveDefaultListPage(precedingItems: number): number {
  return Math.floor(precedingItems / MAIN_LIST_PAGE_SIZE) + 1;
}

export function resolvePageWindow(
  totalItems: number,
  requestedPage: number,
  pageSize: number,
): { page: number; totalPages: number; offset: number } {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(requestedPage, totalPages);
  return { page, totalPages, offset: (page - 1) * pageSize };
}
