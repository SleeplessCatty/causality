import { semanticModelCodes, type SemanticModelCode } from '@causality/semantic-core';

export function parseSmokeModelCode(arguments_: readonly string[]): SemanticModelCode {
  const requestedCode = arguments_.find((argument) => argument !== '--');
  if (!requestedCode || !semanticModelCodes.includes(requestedCode as SemanticModelCode)) {
    throw new Error(`Model code must be one of: ${semanticModelCodes.join(', ')}`);
  }
  return requestedCode as SemanticModelCode;
}
