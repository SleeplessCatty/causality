import { z } from 'zod';

export const pageListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(30),
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
