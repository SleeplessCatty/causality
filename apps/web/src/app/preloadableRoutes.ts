export interface PreloadableRoute<TModule> {
  load(): Promise<TModule>;
  preload(): Promise<void>;
}

export function createPreloadableRoute<TModule>(
  importer: () => Promise<TModule>,
): PreloadableRoute<TModule> {
  let modulePromise: Promise<TModule> | undefined;

  function load(): Promise<TModule> {
    modulePromise ??= importer().catch((error: unknown) => {
      modulePromise = undefined;
      throw error;
    });
    return modulePromise;
  }

  return {
    load,
    preload: async () => {
      await load();
    },
  };
}

export const routeLoaders = {
  eventList: createPreloadableRoute(() => import('../features/events/pages/EventListPage')),
  eventCreate: createPreloadableRoute(() => import('../features/events/pages/EventCreatePage')),
  eventDetail: createPreloadableRoute(() => import('../features/events/pages/EventDetailPage')),
  eventEdit: createPreloadableRoute(() => import('../features/events/pages/EventEditPage')),
  relationList: createPreloadableRoute(
    () => import('../features/relations/pages/RelationListPage'),
  ),
  relationCreate: createPreloadableRoute(
    () => import('../features/relations/pages/RelationCreatePage'),
  ),
  relationDetail: createPreloadableRoute(
    () => import('../features/relations/pages/RelationDetailPage'),
  ),
  relationEdit: createPreloadableRoute(
    () => import('../features/relations/pages/RelationEditPage'),
  ),
  caseList: createPreloadableRoute(() => import('../features/cases/pages/CaseListPage')),
  caseCreate: createPreloadableRoute(() => import('../features/cases/pages/CaseCreatePage')),
  caseDetail: createPreloadableRoute(() => import('../features/cases/pages/CaseDetailPage')),
  caseEdit: createPreloadableRoute(() => import('../features/cases/pages/CaseEditPage')),
  graph: createPreloadableRoute(() => import('../features/causal-graph/pages/CausalGraphPage')),
  maintenance: createPreloadableRoute(() => import('../features/data-maintenance/DataMaintenance')),
  dataTransfer: createPreloadableRoute(() => import('../features/data-transfer/DataTransferPage')),
  importDetail: createPreloadableRoute(
    () => import('../features/data-transfer/pages/ImportDetailPage'),
  ),
  aiImportDetail: createPreloadableRoute(
    () => import('../features/data-transfer/pages/AiImportDetailPage'),
  ),
  settings: createPreloadableRoute(
    () => import('../features/parameter-settings/ParameterSettings'),
  ),
  system: createPreloadableRoute(() => import('../features/system-status/SystemStatus')),
} as const;

export type PreloadableRouteId =
  | 'events'
  | 'relations'
  | 'cases'
  | 'graph'
  | 'maintenance'
  | 'data-transfer'
  | 'settings'
  | 'system';

const navigationRouteLoaders: Record<PreloadableRouteId, PreloadableRoute<unknown>> = {
  events: routeLoaders.eventList,
  relations: routeLoaders.relationList,
  cases: routeLoaders.caseList,
  graph: routeLoaders.graph,
  maintenance: routeLoaders.maintenance,
  'data-transfer': routeLoaders.dataTransfer,
  settings: routeLoaders.settings,
  system: routeLoaders.system,
};

const commonRouteIds: PreloadableRouteId[] = [
  'events',
  'relations',
  'cases',
  'maintenance',
  'data-transfer',
  'settings',
  'system',
];

export async function preloadRoute(routeId: PreloadableRouteId): Promise<void> {
  await navigationRouteLoaders[routeId].preload();
}

export async function preloadCommonRoutes(): Promise<void> {
  await Promise.all(commonRouteIds.map((routeId) => preloadRoute(routeId)));
}
