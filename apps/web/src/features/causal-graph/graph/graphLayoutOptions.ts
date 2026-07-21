export const GRAPH_FIT_PADDING = 48;

export const graphLayoutOptions = {
  name: 'elk',
  fit: false,
  animate: false,
  nodeDimensionsIncludeLabels: false,
  elk: {
    algorithm: 'layered',
    'elk.direction': 'RIGHT',
    'elk.spacing.nodeNode': '60',
    'elk.layered.spacing.nodeNodeBetweenLayers': '140',
  },
} as const;
