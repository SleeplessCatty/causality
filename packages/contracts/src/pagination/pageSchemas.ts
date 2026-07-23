import { z } from 'zod';

export const MAIN_LIST_PAGE_SIZE = 50;
export const DETAIL_ASSOCIATION_PAGE_SIZE = 20;

export const pageListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(MAIN_LIST_PAGE_SIZE),
  })
  .strict();

export const pageListMetadataSchema = z
  .object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().min(1),
  })
  .strict();

export type PageListQuery = z.infer<typeof pageListQuerySchema>;
export type PageListMetadata = z.infer<typeof pageListMetadataSchema>;
