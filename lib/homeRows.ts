export interface HomeCatalogItem {
  key: string
  enabled: boolean
  order: number
  [field: string]: unknown
}

export interface HomeCatalogSettings {
  version?: number
  items: HomeCatalogItem[]
  hero?: Record<string, unknown>
  [field: string]: unknown
}

export interface HomeManifestCatalog {
  type: string
  id: string
  name?: string
}

export interface HomeManifestSummary {
  id: string
  name: string
  catalogs: HomeManifestCatalog[]
}

export interface HomeCollectionSummary {
  id: string
  title: string
}

export interface HomeRowDescription extends HomeCatalogItem {
  addonId: string
  type: string
  catalogId: string
  title: string
  provider: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeHomeCatalogSettings(value: unknown): HomeCatalogSettings | null {
  let candidate: unknown = value
  if (Array.isArray(candidate)) {
    candidate = candidate[0]
  }
  if (isRecord(candidate) && 'settings_json' in candidate) {
    candidate = candidate.settings_json
  }
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate)
    } catch {
      return null
    }
  }
  if (!isRecord(candidate) || !Array.isArray(candidate.items)) {
    return null
  }
  if ('version' in candidate && candidate.version !== undefined && typeof candidate.version !== 'number') {
    return null
  }
  const validItems = candidate.items.every(item =>
    isRecord(item) && typeof item.key === 'string' &&
    typeof item.enabled === 'boolean' && typeof item.order === 'number')
  return validItems ? candidate as HomeCatalogSettings : null
}

export function parseHomeCatalogSettingsResponse(value: unknown): HomeCatalogSettings | null {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) return null
  const normalized = normalizeHomeCatalogSettings(value)
  if (!normalized) throw new Error('Malformed Home catalog settings response')
  return normalized
}

export function toManifestUrl(url: string): string {
  const trimmed = url.trim()
  const queryIndex = trimmed.indexOf('?')
  const path = (queryIndex === -1 ? trimmed : trimmed.slice(0, queryIndex)).replace(/\/$/, '')
  const query = queryIndex === -1 ? '' : trimmed.slice(queryIndex)
  return `${path.endsWith('/manifest.json') ? path : `${path}/manifest.json`}${query}`
}

function parseHomeRowKey(key: string): { addonId: string; type: string; catalogId: string } {
  const first = key.indexOf(':')
  const second = first >= 0 ? key.indexOf(':', first + 1) : -1
  if (first < 1 || second < first + 2) {
    return { addonId: key, type: 'unknown', catalogId: key }
  }
  return {
    addonId: key.slice(0, first),
    type: key.slice(first + 1, second),
    catalogId: key.slice(second + 1),
  }
}

export function describeHomeRows(
  settings: HomeCatalogSettings,
  manifests: HomeManifestSummary[],
  collections: HomeCollectionSummary[] = [],
): HomeRowDescription[] {
  const manifestsById = new Map(manifests.map(manifest => [manifest.id, manifest]))
  const collectionsById = new Map(collections.map(collection => [collection.id, collection]))

  return settings.items
    .map(item => {
      const parsed = parseHomeRowKey(item.key)
      const isCollection = item.is_collection === true || item.key.startsWith('collection_')
      const collectionId = typeof item.collection_id === 'string' && item.collection_id
        ? item.collection_id
        : (isCollection
            ? (parsed.type !== 'unknown' ? parsed.catalogId : item.key.replace(/^collection_?/, ''))
            : '')
      const persistedAddonId = typeof item.addon_id === 'string' ? item.addon_id : ''
      const persistedType = typeof item.type === 'string' ? item.type : ''
      const persistedCatalogId = typeof item.catalog_id === 'string' ? item.catalog_id : ''
      const addonId = isCollection ? '' : (persistedAddonId || parsed.addonId)
      const type = isCollection ? 'collection' : (persistedType || parsed.type)
      const catalogId = isCollection ? collectionId : (persistedCatalogId || parsed.catalogId)
      const manifest = manifestsById.get(addonId)
      const catalog = manifest?.catalogs.find(entry =>
        entry.type === type && entry.id === catalogId)
      const collection = isCollection ? collectionsById.get(collectionId) : undefined
      const customTitle = typeof item.custom_title === 'string' ? item.custom_title.trim() : ''

      return {
        ...item,
        addonId,
        type,
        catalogId,
        title: customTitle || collection?.title || catalog?.name || catalogId || item.key,
        provider: manifest?.name || (isCollection ? 'Nuvio Collection' : 'Unknown addon'),
      }
    })
    .sort((a, b) => a.order - b.order)
}

export function setOnlyEnabledHomeRows(
  settings: HomeCatalogSettings,
  enabledKeys: Set<string>,
): HomeCatalogSettings {
  return {
    ...settings,
    items: settings.items.map(item => ({
      ...item,
      enabled: enabledKeys.has(item.key),
    })),
  }
}
