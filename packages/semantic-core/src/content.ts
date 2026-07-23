import { createHash } from 'node:crypto';

export type SemanticDocumentInput =
  | {
      type: 'event';
      name: string;
      aliases: readonly string[];
      keywords: readonly string[];
      description: string | null;
    }
  | {
      type: 'relation';
      causeEventName: string;
      effectEventName: string;
      description: string | null;
    }
  | {
      type: 'case';
      content: string;
    };

function normalizedValues(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

export function buildSemanticDocument(input: SemanticDocumentInput): string {
  if (input.type === 'case') {
    return `具体案例：${input.content.trim()}`;
  }

  if (input.type === 'relation') {
    const lines = [
      `原因事件：${input.causeEventName.trim()}`,
      `结果事件：${input.effectEventName.trim()}`,
    ];
    if (input.description?.trim()) {
      lines.push(`说明：${input.description.trim()}`);
    }
    return lines.join('\n');
  }

  const aliases = normalizedValues(input.aliases).sort((left, right) =>
    left.localeCompare(right, 'zh-CN'),
  );
  const keywords = normalizedValues(input.keywords);
  const lines = [`事件名称：${input.name.trim()}`];
  if (aliases.length > 0) {
    lines.push(`别名：${aliases.join('、')}`);
  }
  if (keywords.length > 0) {
    lines.push(`关键词：${keywords.join('、')}`);
  }
  if (input.description?.trim()) {
    lines.push(`说明：${input.description.trim()}`);
  }
  return lines.join('\n');
}

export function hashSemanticDocument(document: string): string {
  return createHash('sha256').update(document, 'utf8').digest('hex');
}
