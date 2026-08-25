import test from 'node:test'
import assert from 'node:assert/strict'
import {
  describeHomeRows,
  normalizeHomeCatalogSettings,
  parseHomeCatalogSettingsResponse,
  setOnlyEnabledHomeRows,
  toManifestUrl,
  type HomeCatalogSettings,
  type HomeManifestSummary,
} from '../lib/homeRows.ts'

const settings: HomeCatalogSettings = {
  version: 1,
  hero: { source: 'keep-me' },
  items: [
    { key: 'org.xtremio.cloudflare.staging:movie:xtremio_movies', enabled: true, order: 2 },
    { key: 'app.xperience.current:movie:movies', enabled: false, order: 1 },
    { key: 'app.xperience.old:series:shows', enabled: true, order: 3 },
    { key: 'collection_abc:movie:featured', enabled: true, order: 4 },
  ],
}

const manifests: HomeManifestSummary[] = [
  {
    id: 'org.xtremio.cloudflare.staging',
    name: 'Geraflix',
    catalogs: [{ type: 'movie', id: 'xtremio_movies', name: 'Películas' }],
  },
  {
    id: 'app.xperience.current',
    name: 'Xperience',
    catalogs: [{ type: 'movie', id: 'movies', name: 'Trending Movies' }],
  },
]

test('describes rows using exact manifest ids, never prefix guesses', () => {
  const rows = describeHomeRows(settings, manifests)
  assert.deepEqual(rows.map(({ key, provider, title }) => ({ key, provider, title })), [
    { key: 'app.xperience.current:movie:movies', provider: 'Xperience', title: 'Trending Movies' },
    { key: 'org.xtremio.cloudflare.staging:movie:xtremio_movies', provider: 'Geraflix', title: 'Películas' },
    { key: 'app.xperience.old:series:shows', provider: 'Unknown addon', title: 'shows' },
    { key: 'collection_abc:movie:featured', provider: 'Nuvio Collection', title: 'featured' },
  ])
})

test('sets exactly the selected rows while preserving order and other settings', () => {
  const result = setOnlyEnabledHomeRows(settings, new Set(['app.xperience.current:movie:movies']))
  assert.equal(result.hero?.source, 'keep-me')
  assert.deepEqual(result.items.map(item => [item.key, item.enabled, item.order]), [
    ['org.xtremio.cloudflare.staging:movie:xtremio_movies', false, 2],
    ['app.xperience.current:movie:movies', true, 1],
    ['app.xperience.old:series:shows', false, 3],
    ['collection_abc:movie:featured', false, 4],
  ])
  assert.notEqual(result, settings)
  assert.notEqual(result.items, settings.items)
})

test('normalizes direct, wrapped and JSON-string RPC responses', () => {
  const realShape = { items: settings.items, showCatalogType: false }
  assert.deepEqual(normalizeHomeCatalogSettings(settings), settings)
  assert.deepEqual(normalizeHomeCatalogSettings([{ settings_json: realShape }]), realShape)
  assert.deepEqual(normalizeHomeCatalogSettings([{ settings_json: JSON.stringify(realShape) }]), realShape)
  assert.equal(normalizeHomeCatalogSettings([{ settings_json: { nope: true } }]), null)
  assert.equal(normalizeHomeCatalogSettings(null), null)
})

test('distinguishes missing settings from malformed RPC data', () => {
  assert.equal(parseHomeCatalogSettingsResponse([]), null)
  assert.equal(parseHomeCatalogSettingsResponse(null), null)
  assert.throws(
    () => parseHomeCatalogSettingsResponse([{ settings_json: { items: [{ key: 'bad' }] } }]),
    /malformed/i,
  )
})

test('normalizes addon URLs without corrupting query strings', () => {
  assert.equal(toManifestUrl('https://example.com/'), 'https://example.com/manifest.json')
  assert.equal(
    toManifestUrl('https://example.com/config/manifest.json?token=abc'),
    'https://example.com/config/manifest.json?token=abc',
  )
})

test('uses persisted snake_case metadata and collection titles when available', () => {
  const rows = describeHomeRows({
    items: [
      {
        key: 'opaque-row-key', enabled: true, order: 0,
        addon_id: 'app.xperience.current', type: 'movie', catalog_id: 'featured',
        custom_title: 'Featured movies', is_collection: false,
      },
      {
        key: 'collection-1', enabled: false, order: 1,
        addon_id: '', type: '', catalog_id: '', custom_title: '',
        collection_id: '1', is_collection: true,
      },
    ],
  }, manifests, [{ id: '1', title: 'My List' }])
  assert.equal(rows[0].provider, 'Xperience')
  assert.equal(rows[0].title, 'Featured movies')
  assert.equal(rows[1].provider, 'Nuvio Collection')
  assert.equal(rows[1].title, 'My List')
  assert.equal(rows[1].type, 'collection')
  assert.equal(rows[1].catalogId, '1')
})

test('handles malformed keys without crashing', () => {
  const rows = describeHomeRows({ version: 1, items: [{ key: 'broken', enabled: true, order: 0 }] }, manifests)
  assert.equal(rows[0].provider, 'Unknown addon')
  assert.equal(rows[0].title, 'broken')
  assert.equal(rows[0].type, 'unknown')
})
