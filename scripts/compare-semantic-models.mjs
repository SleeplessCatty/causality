/* global AbortSignal, URLSearchParams, console, fetch, process, setTimeout */

const baseUrl = (process.env.CAUSALITY_APP_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const pollIntervalMs = Number(process.env.CAUSALITY_SEMANTIC_POLL_INTERVAL_MS ?? 500);
const timeoutMs = Number(process.env.CAUSALITY_SEMANTIC_TIMEOUT_MS ?? 15 * 60 * 1000);
const finalModel = process.env.CAUSALITY_SEMANTIC_FINAL_MODEL ?? 'bge-small-zh-v1.5';

const modelCodes = [
  'bge-small-zh-v1.5',
  'multilingual-e5-small',
  'granite-embedding-97m-multilingual-r2',
  'bge-m3',
];

const checks = [
  {
    type: 'event',
    query: '企业借钱变得更贵',
    expected: ['企业融资成本上升'],
  },
  {
    type: 'event',
    query: '网页打开越来越慢',
    expected: ['服务响应延迟增加'],
  },
  {
    type: 'event',
    query: '学生经常不来上课',
    expected: ['学生出勤率下降'],
  },
  {
    type: 'event',
    query: '货轮在码头外等得更久',
    expected: ['船舶泊位等待时间延长'],
  },
  {
    type: 'relation',
    query: '连续下大雪让路面变滑',
    expected: ['持续降雪发生', '道路表面摩擦力下降'],
  },
  {
    type: 'relation',
    query: '漏洞被利用以后服务器失陷',
    expected: ['漏洞被攻击者利用', '服务器主机被入侵'],
  },
  {
    type: 'relation',
    query: '托儿服务变多让家庭照护压力减轻',
    expected: ['普惠托育服务供给增加', '家庭照护压力下降'],
  },
  {
    type: 'relation',
    query: '堵车导致同城送货晚点',
    expected: ['城市道路拥堵加重', '同城配送延误增加'],
  },
  {
    type: 'case',
    query: '工厂借贷利息变高以后减少投资',
    expected: ['政策利率上升', '企业融资成本上升'],
  },
  {
    type: 'case',
    query: '线上访问卡顿之后接口大量超时',
    expected: ['服务响应延迟增加', '请求超时率上升'],
  },
  {
    type: 'case',
    query: '沿江地区连日暴雨造成水位超警',
    expected: ['强降雨持续发生', '河流水位上涨'],
  },
  {
    type: 'case',
    query: '码头作业缓慢使集装箱堆得越来越多',
    expected: ['港口装卸效率下降', '港区集装箱积压增加'],
  },
];

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(
      `${options.method ?? 'GET'} ${path} returned ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

async function waitUntilReady(modelCode) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const settings = await requestJson('/api/semantic/settings');
    if (settings.activeModelCode === modelCode && settings.index.status === 'ready') {
      return { settings, elapsedMs: Date.now() - startedAt };
    }
    if (settings.activeModelCode === modelCode && settings.index.status === 'failed') {
      throw new Error(`${modelCode} indexing failed: ${settings.index.error ?? 'unknown error'}`);
    }
    await delay(pollIntervalMs);
  }
  throw new Error(`${modelCode} did not become ready within ${timeoutMs} ms`);
}

async function useModel(modelCode) {
  await requestJson(`/api/semantic/models/${encodeURIComponent(modelCode)}/use`, {
    method: 'POST',
  });
  return waitUntilReady(modelCode);
}

function itemMatches(type, item, expected) {
  if (type === 'event') return expected.includes(item.name);
  if (type === 'relation') {
    return item.causeEvent?.name === expected[0] && item.effectEvent?.name === expected[1];
  }
  return expected.every((value) => item.content?.includes(value));
}

async function search(check, searchMode) {
  const path =
    check.type === 'event'
      ? '/api/events'
      : check.type === 'relation'
        ? '/api/relations'
        : '/api/cases';
  const parameters = new URLSearchParams({
    q: check.query,
    page: '1',
    limit: '50',
    searchMode,
  });
  const response = await requestJson(`${path}?${parameters}`);
  return response.items.some((item) => itemMatches(check.type, item, check.expected));
}

async function evaluateActiveModel(modelCode, indexingSeconds) {
  let standardHits = 0;
  let enhancedHits = 0;
  const details = [];
  for (const check of checks) {
    const standard = await search(check, 'standard');
    const enhanced = await search(check, 'enhanced');
    if (standard) standardHits += 1;
    if (enhanced) enhancedHits += 1;
    details.push({ ...check, standard, enhanced });
  }
  return {
    modelCode,
    indexingSeconds: Math.round(indexingSeconds * 100) / 100,
    queryCount: checks.length,
    standardHits,
    enhancedHits,
    improvement: enhancedHits - standardHits,
    details,
  };
}

async function main() {
  await requestJson('/api/ready');
  const results = [];
  try {
    for (const modelCode of modelCodes) {
      process.stdout.write(`Activating and indexing ${modelCode}...\n`);
      const { elapsedMs } = await useModel(modelCode);
      results.push(await evaluateActiveModel(modelCode, elapsedMs / 1000));
    }
  } finally {
    const settings = await requestJson('/api/semantic/settings').catch(() => undefined);
    if (settings?.activeModelCode !== finalModel || settings?.index.status !== 'ready') {
      process.stdout.write(`Restoring ${finalModel} as the active model...\n`);
      await useModel(finalModel);
    }
  }

  process.stdout.write('\nActual application/database semantic comparison:\n');
  console.table(
    results.map(
      ({ modelCode, indexingSeconds, queryCount, standardHits, enhancedHits, improvement }) => ({
        model: modelCode,
        'index seconds': indexingSeconds,
        queries: queryCount,
        'standard hits': standardHits,
        'enhanced hits': enhancedHits,
        improvement,
      }),
    ),
  );
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);

  if (!results.some((result) => result.improvement > 0)) {
    throw new Error('No model improved on ordinary search against the seeded application database');
  }
}

await main();
