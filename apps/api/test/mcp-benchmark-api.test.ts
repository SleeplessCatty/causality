import { beforeEach, describe, expect, it, vi } from 'vitest';

const semanticConstructor = vi.fn();

vi.mock('../src/features/ai-capture/aiSemanticCandidateService.js', () => ({
  AiSemanticCandidateService: class {
    public constructor(options: unknown) {
      semanticConstructor(options);
    }
    public compare = vi.fn();
    public topicRelevance = vi.fn();
  },
}));

describe('MCP benchmark semantic dependency boundary', () => {
  beforeEach(() => semanticConstructor.mockClear());

  it('constructs the real semantic service by default and accepts only an explicit adapter', async () => {
    const { createAiCaptureRouteDependencies } =
      await import('../src/features/ai-capture/aiCaptureRoutes.js');
    const pool = {} as never;
    const worker = {} as never;
    createAiCaptureRouteDependencies(pool, worker);
    expect(semanticConstructor).toHaveBeenCalledOnce();

    semanticConstructor.mockClear();
    const adapter = {
      compare: vi.fn(async (_entityType, texts: readonly string[]) => texts.map(() => [])),
      topicRelevance: vi.fn(async (_topic, events: readonly { ref: string }[]) =>
        events.map((event) => ({ ref: event.ref, similarity: 1 })),
      ),
    };
    createAiCaptureRouteDependencies(pool, worker, adapter);
    expect(semanticConstructor).not.toHaveBeenCalled();
  });
});
