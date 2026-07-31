export type McpCheckTransport = 'streamable-http' | 'stdio';
export type McpCheckStatus = 'passed' | 'failed' | 'skipped';

export interface McpCheckItem {
  id: string;
  label: string;
  status: McpCheckStatus;
  durationMs: number;
  message: string;
  suggestedAction: string | null;
}

export interface McpCheckReport {
  schemaVersion: 1;
  transport: McpCheckTransport;
  endpoint: string | null;
  startedAt: string;
  completedAt: string;
  success: boolean;
  counts: { tools: number; prompts: number; resources: number };
  items: McpCheckItem[];
}
