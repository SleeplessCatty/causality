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
      'underlay-color': '#1f513b',
      'underlay-opacity': 0.07,
      'underlay-padding': 6,
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
      'underlay-opacity': 0.13,
      'underlay-padding': 8,
    },
  },
  {
    selector: 'node.is-current',
    style: {
      'border-width': 4,
      'border-color': '#124c35',
      'underlay-opacity': 0.22,
      'underlay-padding': 10,
    },
  },
  {
    selector: 'edge',
    style: {
      width: 1.6,
      'line-color': '#4f876d',
      'target-arrow-color': '#39745a',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 0.9,
      'curve-style': 'bezier',
      label: 'data(label)',
      'font-size': 10,
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
    },
  },
  {
    selector: 'edge.is-current',
    style: {
      width: 3.6,
      'line-color': '#124c35',
      'target-arrow-color': '#124c35',
      'arrow-scale': 1.05,
    },
  },
];
