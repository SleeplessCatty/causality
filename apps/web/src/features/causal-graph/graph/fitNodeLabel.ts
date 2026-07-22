export const GRAPH_NODE_WIDTH = 220;
export const GRAPH_NODE_HEIGHT = 96;
export const GRAPH_NODE_TEXT_WIDTH = 208;
export const GRAPH_NODE_TEXT_HEIGHT = 84;
export const GRAPH_NODE_FONT_SIZE = 22;
export const GRAPH_NODE_MAX_LINES = 3;
export const GRAPH_NODE_FONT_FAMILY = 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif';

const ellipsis = '…';

export interface FittedNodeLabel {
  text: string;
  fontSize: typeof GRAPH_NODE_FONT_SIZE;
}

export type TextMeasurer = (text: string, fontSize: number) => number;

let measurementContext: CanvasRenderingContext2D | null | undefined;

function browserMeasureText(text: string, fontSize: number): number {
  if (measurementContext === undefined) {
    measurementContext = document.createElement('canvas').getContext('2d');
  }
  if (!measurementContext) return Array.from(text).length * fontSize;
  measurementContext.font = `600 ${fontSize}px ${GRAPH_NODE_FONT_FAMILY}`;
  return measurementContext.measureText(text).width;
}

function splitOversizedToken(token: string, fontSize: number, measure: TextMeasurer): string[] {
  const pieces: string[] = [];
  let current = '';

  for (const character of Array.from(token)) {
    if (current && measure(current + character, fontSize) > GRAPH_NODE_TEXT_WIDTH) {
      pieces.push(current);
      current = character;
    } else {
      current += character;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

function wrapLabel(name: string, fontSize: number, measure: TextMeasurer): string[] {
  const tokens = name.match(/\r\n|\r|\n|[^\S\r\n]+|[\p{Script=Han}]|[^\s\p{Script=Han}]+/gu) ?? [
    name,
  ];
  const lines: string[] = [];
  let current = '';
  let pendingWhitespace = '';

  function pushToken(token: string): void {
    const content = pendingWhitespace + token;
    pendingWhitespace = '';
    if (measure(current + content, fontSize) <= GRAPH_NODE_TEXT_WIDTH) {
      current += content;
      return;
    }
    if (current) lines.push(current);
    current = '';

    const pieces = splitOversizedToken(content, fontSize, measure);
    lines.push(...pieces.slice(0, -1));
    current = pieces.at(-1) ?? '';
  }

  for (const token of tokens) {
    if (/^(?:\r\n|\r|\n)$/u.test(token)) {
      if (pendingWhitespace) pushToken('');
      lines.push(current);
      current = '';
    } else if (/^[^\S\r\n]+$/u.test(token)) {
      pendingWhitespace += token;
    } else {
      pushToken(token);
    }
  }
  if (pendingWhitespace) pushToken('');
  if (current) lines.push(current);
  return lines;
}

export function fitNodeLabel(
  name: string,
  measure: TextMeasurer = browserMeasureText,
): FittedNodeLabel {
  const lines = wrapLabel(name, GRAPH_NODE_FONT_SIZE, measure);
  if (lines.length <= GRAPH_NODE_MAX_LINES) {
    return { text: lines.join('\n'), fontSize: GRAPH_NODE_FONT_SIZE };
  }

  const visibleLines = lines.slice(0, GRAPH_NODE_MAX_LINES);
  const finalLine = Array.from(visibleLines.at(-1)?.trimEnd() ?? '');
  while (
    finalLine.length > 0 &&
    measure(finalLine.join('') + ellipsis, GRAPH_NODE_FONT_SIZE) > GRAPH_NODE_TEXT_WIDTH
  ) {
    finalLine.pop();
  }
  visibleLines[GRAPH_NODE_MAX_LINES - 1] = finalLine.join('') + ellipsis;

  return {
    text: visibleLines.join('\n'),
    fontSize: GRAPH_NODE_FONT_SIZE,
  };
}
