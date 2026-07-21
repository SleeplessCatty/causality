export const GRAPH_NODE_WIDTH = 220;
export const GRAPH_NODE_HEIGHT = 96;
export const GRAPH_NODE_TEXT_WIDTH = 196;
export const GRAPH_NODE_TEXT_HEIGHT = 72;

const fontSizes = [14, 12, 10, 9] as const;
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
  const tokens = name.match(/[\p{Script=Han}]|[^\s\p{Script=Han}]+|\s+/gu) ?? [name];
  const lines: string[] = [];
  let current = '';
  let pendingSpace = false;

  function pushToken(token: string): void {
    const separator = current && pendingSpace ? ' ' : '';
    if (measure(current + separator + token, fontSize) <= GRAPH_NODE_TEXT_WIDTH) {
      current += separator + token;
      pendingSpace = false;
      return;
    }
    if (current) lines.push(current);
    current = '';
    pendingSpace = false;

    const pieces = splitOversizedToken(token, fontSize, measure);
    lines.push(...pieces.slice(0, -1));
    current = pieces.at(-1) ?? '';
  }

  for (const token of tokens) {
    if (/^\s+$/u.test(token)) {
      pendingSpace = true;
    } else {
      pushToken(token);
    }
  }
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

  return { text: wrapLabel(name, 9, measure).join('\n'), fontSize: 9 };
}
