import { z } from 'zod';

import { caseContentSchema } from '../cases/caseSchemas.js';
import { eventNameSchema } from '../events/eventSchemas.js';
import { relationConfidenceSchema } from '../relations/relationSchemas.js';

const timestampSchema = z.iso.datetime({ offset: true });

export const causalPathEventSchema = z
  .object({
    id: z.uuid(),
    name: eventNameSchema,
  })
  .strict();

export const causalPathRelationSchema = z
  .object({
    id: z.uuid(),
    causeEventId: z.uuid(),
    effectEventId: z.uuid(),
    confidence: relationConfidenceSchema,
    caseCount: z.number().int().nonnegative(),
  })
  .strict();

export const causalPathQuerySchema = z
  .object({
    sourceEventId: z.uuid(),
    targetEventId: z.uuid(),
    maxDepth: z.coerce.number().int().min(1).max(10).default(5),
    pathLimit: z.coerce.number().int().min(1).max(10).default(10),
    minConfidence: z.coerce.number().finite().min(0).max(100).default(0),
    minCaseCount: z.coerce.number().int().min(0).max(1_000).default(0),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sourceEventId === value.targetEventId) {
      context.addIssue({
        code: 'custom',
        path: ['targetEventId'],
        message: '起点事件和终点事件不能相同',
      });
    }
  });

export const causalPathSchema = z
  .object({
    events: z.array(causalPathEventSchema).min(2).max(11),
    relations: z.array(causalPathRelationSchema).min(1).max(10),
    hopCount: z.number().int().min(1).max(10),
    minimumConfidence: relationConfidenceSchema,
    totalCaseCount: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.events.length !== value.hopCount + 1) {
      context.addIssue({
        code: 'custom',
        path: ['events'],
        message: '路径事件数量必须比跳数多一',
      });
    }
    if (value.relations.length !== value.hopCount) {
      context.addIssue({
        code: 'custom',
        path: ['relations'],
        message: '路径关系数量必须等于跳数',
      });
    }
    value.relations.forEach((relation, index) => {
      const cause = value.events[index];
      const effect = value.events[index + 1];
      if (cause && relation.causeEventId !== cause.id) {
        context.addIssue({
          code: 'custom',
          path: ['relations', index, 'causeEventId'],
          message: '路径关系原因事件与事件序列不一致',
        });
      }
      if (effect && relation.effectEventId !== effect.id) {
        context.addIssue({
          code: 'custom',
          path: ['relations', index, 'effectEventId'],
          message: '路径关系结果事件与事件序列不一致',
        });
      }
    });
  });

export const causalPathTruncatedReasonSchema = z.enum(['path_limit', 'expansion_limit']);

export const causalPathResponseSchema = z
  .object({
    sourceEvent: causalPathEventSchema,
    targetEvent: causalPathEventSchema,
    paths: z.array(causalPathSchema).max(10),
    truncated: z.boolean(),
    truncatedReason: causalPathTruncatedReasonSchema.nullable(),
    expandedStateCount: z.number().int().min(0).max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.truncated !== (value.truncatedReason !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['truncatedReason'],
        message: '截断状态与截断原因不一致',
      });
    }
    value.paths.forEach((path, index) => {
      if (path.events[0]?.id !== value.sourceEvent.id) {
        context.addIssue({
          code: 'custom',
          path: ['paths', index, 'events', 0],
          message: '路径起点与查询起点不一致',
        });
      }
      if (path.events.at(-1)?.id !== value.targetEvent.id) {
        context.addIssue({
          code: 'custom',
          path: ['paths', index, 'events', path.events.length - 1],
          message: '路径终点与查询终点不一致',
        });
      }
    });
  });

export const causalEvidenceCaseSchema = z
  .object({
    id: z.uuid(),
    content: caseContentSchema,
    linkedAt: timestampSchema,
  })
  .strict();

export const causalEvidenceStatusSchema = z.enum(['supported', 'no_cases']);

export const causalEvidenceRelationSchema = causalPathRelationSchema
  .extend({
    description: z.string().max(2_000).nullable(),
    cases: z.array(causalEvidenceCaseSchema).max(20),
    returnedCaseCount: z.number().int().min(0).max(20),
    casesTruncated: z.boolean(),
    evidenceStatus: causalEvidenceStatusSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.returnedCaseCount !== value.cases.length) {
      context.addIssue({
        code: 'custom',
        path: ['returnedCaseCount'],
        message: '返回案例数与案例数组长度不一致',
      });
    }
    if (value.casesTruncated !== value.caseCount > value.returnedCaseCount) {
      context.addIssue({
        code: 'custom',
        path: ['casesTruncated'],
        message: '案例截断状态与案例数量不一致',
      });
    }
    const expectedStatus = value.caseCount === 0 ? 'no_cases' : 'supported';
    if (value.evidenceStatus !== expectedStatus) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceStatus'],
        message: '案例依据状态与案例数量不一致',
      });
    }
  });

export const causalEvidenceBundleInputSchema = z
  .object({
    relationIds: z.array(z.uuid()).min(1).max(10),
    caseLimitPerRelation: z.number().int().min(1).max(20).default(5),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.relationIds.forEach((id, index) => {
      if (seen.has(id)) {
        context.addIssue({
          code: 'custom',
          path: ['relationIds', index],
          message: '路径不能重复包含同一关系',
        });
      }
      seen.add(id);
    });
  });

export const causalEvidenceBundleResponseSchema = z
  .object({
    events: z.array(causalPathEventSchema).min(2).max(11),
    relations: z.array(causalEvidenceRelationSchema).min(1).max(10),
    hopCount: z.number().int().min(1).max(10),
    minimumConfidence: relationConfidenceSchema,
    totalCaseCount: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.events.length !== value.hopCount + 1) {
      context.addIssue({
        code: 'custom',
        path: ['events'],
        message: '证据包事件数量必须比跳数多一',
      });
    }
    if (value.relations.length !== value.hopCount) {
      context.addIssue({
        code: 'custom',
        path: ['relations'],
        message: '证据包关系数量必须等于跳数',
      });
    }
    value.relations.forEach((relation, index) => {
      if (relation.causeEventId !== value.events[index]?.id) {
        context.addIssue({
          code: 'custom',
          path: ['relations', index, 'causeEventId'],
          message: '证据关系原因事件与事件序列不一致',
        });
      }
      if (relation.effectEventId !== value.events[index + 1]?.id) {
        context.addIssue({
          code: 'custom',
          path: ['relations', index, 'effectEventId'],
          message: '证据关系结果事件与事件序列不一致',
        });
      }
    });
  });

export type CausalPathQuery = z.infer<typeof causalPathQuerySchema>;
export type CausalPathResponse = z.infer<typeof causalPathResponseSchema>;
export type CausalPath = z.infer<typeof causalPathSchema>;
export type CausalPathEvent = z.infer<typeof causalPathEventSchema>;
export type CausalPathRelation = z.infer<typeof causalPathRelationSchema>;
export type CausalPathTruncatedReason = z.infer<typeof causalPathTruncatedReasonSchema>;
export type CausalEvidenceCase = z.infer<typeof causalEvidenceCaseSchema>;
export type CausalEvidenceStatus = z.infer<typeof causalEvidenceStatusSchema>;
export type CausalEvidenceRelation = z.infer<typeof causalEvidenceRelationSchema>;
export type CausalEvidenceBundleInput = z.infer<typeof causalEvidenceBundleInputSchema>;
export type CausalEvidenceBundleResponse = z.infer<typeof causalEvidenceBundleResponseSchema>;
