import {
  semanticSettingsResponseSchema,
  semanticUseModelResponseSchema,
  type SemanticModelCode,
  type SemanticSettingsResponse,
  type SemanticUseModelResponse,
} from '@causality/contracts';

import { requestJson } from '../../shared/api/httpClient';

const actionTimeoutMilliseconds = 15_000;

export async function getSemanticSettings(signal?: AbortSignal): Promise<SemanticSettingsResponse> {
  return semanticSettingsResponseSchema.parse(
    await requestJson('/api/semantic/settings', {}, signal),
  );
}

export async function useSemanticModel(
  modelCode: SemanticModelCode,
): Promise<SemanticUseModelResponse> {
  return semanticUseModelResponseSchema.parse(
    await requestJson(
      `/api/semantic/models/${modelCode}/use`,
      { method: 'POST' },
      undefined,
      actionTimeoutMilliseconds,
    ),
  );
}

export async function updateSemanticThreshold(
  modelCode: SemanticModelCode,
  threshold: number,
): Promise<SemanticSettingsResponse> {
  return semanticSettingsResponseSchema.parse(
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

export async function retrySemanticTask(): Promise<SemanticUseModelResponse> {
  return semanticUseModelResponseSchema.parse(
    await requestJson(
      '/api/semantic/retry',
      { method: 'POST' },
      undefined,
      actionTimeoutMilliseconds,
    ),
  );
}
