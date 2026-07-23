import { describe, expect, it } from 'vitest';

import { buildSemanticDocument, hashSemanticDocument } from '../src/index.js';

describe('semantic document content', () => {
  it('builds deterministic event content with sorted aliases and ordered keywords', () => {
    expect(
      buildSemanticDocument({
        type: 'event',
        name: '政策利率上调',
        aliases: ['提高政策利率', '加息'],
        keywords: ['利率', '货币政策'],
        description: '中央银行提高基准政策利率',
      }),
    ).toBe(
      '事件名称：政策利率上调\n别名：加息、提高政策利率\n关键词：利率、货币政策\n说明：中央银行提高基准政策利率',
    );
  });

  it('omits empty optional fields without blank lines', () => {
    expect(
      buildSemanticDocument({
        type: 'event',
        name: '流动性收紧',
        aliases: [],
        keywords: [],
        description: null,
      }),
    ).toBe('事件名称：流动性收紧');
  });

  it('builds relation content without cases or confidence', () => {
    expect(
      buildSemanticDocument({
        type: 'relation',
        causeEventName: '政策利率上调',
        effectEventName: '融资成本上升',
        description: null,
      }),
    ).toBe('原因事件：政策利率上调\n结果事件：融资成本上升');
  });

  it('builds concrete case content', () => {
    expect(
      buildSemanticDocument({
        type: 'case',
        content: '央行宣布将政策利率上调 25 个基点',
      }),
    ).toBe('具体案例：央行宣布将政策利率上调 25 个基点');
  });

  it('returns a stable SHA-256 document hash', () => {
    expect(hashSemanticDocument('事件名称：政策利率上调')).toBe(
      '05b115c7b260776296c30b0ff16d5e1a088d70ac0b24e92c8eb34b34f85df619',
    );
  });
});
