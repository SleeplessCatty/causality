import type { StylesheetJson } from 'cytoscape';

export const graphStyles: StylesheetJson = [
  {
    selector: 'node',
    style: {
      width: 'data(width)',
      height: 'data(height)',
      shape: 'round-rectangle',
      label: 'data(label)',
      'font-size': 'data(fontSize)',
      'font-weight': 600,
      'text-wrap': 'wrap',
      'text-valign': 'center',
      'text-halign': 'center',
      color: '#183328',
      'background-color': '#ffffff',
      'border-width': 1.5,
      'border-color': '#72a58c',
    },
  },
  {
    selector: 'node[?isCenter]',
    style: {
      'background-color': '#e4f3ea',
      'border-width': 3,
      'border-color': '#247052',
      'font-weight': 700,
    },
  },
  {
    selector: 'node.is-context',
    style: {
      'border-width': 2.5,
      'border-color': '#3d8062',
    },
  },
  {
    selector: 'node.is-current',
    style: {
      'border-width': 4,
      'border-color': '#124c35',
    },
  },
  {
    selector: 'edge',
    style: {
      width: 1.6,
      'line-color': '#4f876d',
      'target-arrow-color': '#39745a',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 1.3,
      'curve-style': 'bezier',
      label: 'data(label)',
      'font-size': 12,
      'font-weight': 600,
      color: '#365647',
      'text-background-color': '#fffefa',
      'text-background-opacity': 0.86,
      'text-background-padding': '3px',
      'text-background-shape': 'roundrectangle',
      'text-rotation': 'autorotate',
      'overlay-opacity': 0,
      'overlay-padding': 10,
    },
  },
  {
    selector: 'edge.is-context',
    style: {
      width: 2.6,
      'line-color': '#2b7454',
      'target-arrow-color': '#2b7454',
      'arrow-scale': 1.4,
    },
  },
  {
    selector: 'edge.is-incoming',
    style: {
      'line-color': '#2f6f9f',
      'target-arrow-color': '#2f6f9f',
    },
  },
  {
    selector: 'edge.is-outgoing',
    style: {
      'line-color': '#b56832',
      'target-arrow-color': '#b56832',
    },
  },
  {
    selector: 'edge.is-current',
    style: {
      width: 3.6,
      'line-color': '#124c35',
      'target-arrow-color': '#124c35',
      'arrow-scale': 1.5,
    },
  },
];
