export const GRAPH_NODE_WIDTH = 220;
export const GRAPH_NODE_HEIGHT = 96;
export const GRAPH_NODE_TEXT_WIDTH = 208;
export const GRAPH_NODE_TEXT_HEIGHT = 84;

const fontSizes = [17, 16, 15, 14, 13, 12, 11, 10] as const;
const lineHeightRatio = 1.3;

export interface FittedNodeLabel {
  text: string;
  fontSize: (typeof fontSizes)[number];
}

export type TextMeasurer = (text: string, fontSize: number) => number;

let measurementContext: CanvasRenderingContext2D | null | undefined;

function browserMeasureText(text: string, fontSize: number): number {
  if (measurementContext === undefined) {
    measurementContext = document.createElement('canvas').getContext('2d');
  }
  if (!measurementContext) return Array.from(text).length * fontSize;
  measurementContext.font = `600 ${fontSize}px Inter, "PingFang SC", "Microsoft YaHei", sans-serif`;
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
  for (const fontSize of fontSizes) {
    const lines = wrapLabel(name, fontSize, measure);
    if (lines.length * fontSize * lineHeightRatio <= GRAPH_NODE_TEXT_HEIGHT) {
      return { text: lines.join('\n'), fontSize };
    }
  }

  const minimumFontSize = fontSizes.at(-1)!;
  return {
    text: wrapLabel(name, minimumFontSize, measure).join('\n'),
    fontSize: minimumFontSize,
  };
}
