import { MCP_CAPABILITY_MANIFEST } from '../capabilities/capabilityManifest.js';
import { buildDomainModelRules } from '../prompts/analysisPolicy.js';
import { buildCausalityCapturePrompt } from '../prompts/capturePrompt.js';
import { capabilityManifestSchema } from './resourceSchemas.js';

export function buildDomainModelResource(): string {
  return buildDomainModelRules();
}

export function buildCaptureRulesResource(): string {
  return buildCausalityCapturePrompt();
}

export function buildCapabilitiesResource(): string {
  const manifest = capabilityManifestSchema.parse(MCP_CAPABILITY_MANIFEST);
  return JSON.stringify(manifest, null, 2);
}
