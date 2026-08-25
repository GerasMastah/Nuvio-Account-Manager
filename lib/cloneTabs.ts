export type CloneTabId = 'addons' | 'plugins' | 'collections' | 'homeRows'

interface CloneTabSource {
  addons?: unknown[] | null
  plugins?: unknown[] | null
  collections?: unknown[] | null
  homeRows?: unknown[] | null
  homeCatalogSettings?: unknown | null
}

export function firstAvailableCloneTab(source: CloneTabSource): CloneTabId {
  if ((source.addons?.length ?? 0) > 0) return 'addons'
  if ((source.plugins?.length ?? 0) > 0) return 'plugins'
  if ((source.collections?.length ?? 0) > 0) return 'collections'
  if (source.homeCatalogSettings != null || (source.homeRows?.length ?? 0) > 0) return 'homeRows'
  return 'addons'
}
