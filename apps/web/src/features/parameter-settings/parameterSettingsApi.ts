import {
  mcpSettingsResponseSchema,
  mcpTokenRotationResponseSchema,
  semanticActionAcceptedSchema,
  semanticLifecycleSnapshotSchema,
  type McpSettingsResponse,
  type McpTokenRotationResponse,
  type SemanticActionAccepted,
  type SemanticLifecycleSnapshot,
  type SemanticModelCode,
} from '@causality/contracts';

import { requestJson } from '../../shared/api/httpClient';

const actionTimeoutMilliseconds = 15_000;

export async function getMcpSettings(signal?: AbortSignal): Promise<McpSettingsResponse> {
  return mcpSettingsResponseSchema.parse(await requestJson('/api/mcp/settings', {}, signal));
}

export async function rotateMcpToken(): Promise<McpTokenRotationResponse> {
  return mcpTokenRotationResponseSchema.parse(
    await requestJson(
      '/api/mcp/settings/rotate-token',
      { method: 'POST' },
      undefined,
      actionTimeoutMilliseconds,
    ),
  );
}

export async function getSemanticLifecycle(
  signal?: AbortSignal,
): Promise<SemanticLifecycleSnapshot> {
  return semanticLifecycleSnapshotSchema.parse(
    await requestJson('/api/semantic/lifecycle', {}, signal),
  );
}

async function postModelAction(
  modelCode: SemanticModelCode,
  action: 'use' | 'retry-download' | 'redownload' | 'retry-load' | 'retry-full-index',
): Promise<SemanticActionAccepted> {
  return semanticActionAcceptedSchema.parse(
    await requestJson(
      `/api/semantic/models/${modelCode}/${action}`,
      { method: 'POST' },
      undefined,
      actionTimeoutMilliseconds,
    ),
  );
}

export async function useSemanticModel(
  modelCode: SemanticModelCode,
): Promise<SemanticActionAccepted> {
  return postModelAction(modelCode, 'use');
}

export async function retrySemanticDownload(
  modelCode: SemanticModelCode,
): Promise<SemanticActionAccepted> {
  return postModelAction(modelCode, 'retry-download');
}

export async function redownloadSemanticModel(
  modelCode: SemanticModelCode,
): Promise<SemanticActionAccepted> {
  return postModelAction(modelCode, 'redownload');
}

export async function retrySemanticLoad(
  modelCode: SemanticModelCode,
): Promise<SemanticActionAccepted> {
  return postModelAction(modelCode, 'retry-load');
}

export async function retrySemanticFullIndex(
  modelCode: SemanticModelCode,
): Promise<SemanticActionAccepted> {
  return postModelAction(modelCode, 'retry-full-index');
}

export async function updateSemanticThreshold(
  modelCode: SemanticModelCode,
  threshold: number,
): Promise<SemanticLifecycleSnapshot> {
  return semanticLifecycleSnapshotSchema.parse(
    await requestJson(
      `/api/semantic/models/${modelCode}/threshold`,
      {
        method: 'PATCH',
        body: JSON.stringify({ threshold }),
      },
      undefined,
      actionTimeoutMilliseconds,
    ),
  );
}

export async function updateSemanticDedupeThreshold(
  modelCode: SemanticModelCode,
  threshold: number,
): Promise<SemanticLifecycleSnapshot> {
  return semanticLifecycleSnapshotSchema.parse(
    await requestJson(
      `/api/semantic/models/${modelCode}/dedupe-threshold`,
      {
        method: 'PATCH',
        body: JSON.stringify({ threshold }),
      },
      undefined,
      actionTimeoutMilliseconds,
    ),
  );
}

export async function reindexSemanticModel(): Promise<SemanticActionAccepted> {
  return semanticActionAcceptedSchema.parse(
    await requestJson(
      '/api/semantic/reindex',
      { method: 'POST' },
      undefined,
      actionTimeoutMilliseconds,
    ),
  );
}
