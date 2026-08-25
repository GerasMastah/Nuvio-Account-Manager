import { NextRequest, NextResponse } from 'next/server'
import {
  signIn, getProfiles, getAddons, getPlugins, getCollections,
  getHomeCatalogSettings, getAddonManifestSummaries,
} from '@/lib/nuvio'
import { describeHomeRows } from '@/lib/homeRows'

export async function POST(req: NextRequest) {
  try {
    const { email, password, profileId } = await req.json()
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
    }
    const auth = await signIn(email, password)
    const profiles = await getProfiles(auth.access_token)
    const pid = profileId ?? 1
    const [addons, plugins, collections, homeCatalogSettings] = await Promise.all([
      getAddons(auth.access_token, pid),
      getPlugins(auth.access_token, pid),
      getCollections(auth.access_token, pid),
      getHomeCatalogSettings(auth.access_token, pid),
    ])
    const manifests = homeCatalogSettings
      ? await getAddonManifestSummaries(addons)
      : []
    const collectionSummaries = (collections ?? []).flatMap(collection => {
      if (!collection || typeof collection !== 'object') return []
      const record = collection as Record<string, unknown>
      return typeof record.id === 'string' && typeof record.title === 'string'
        ? [{ id: record.id, title: record.title }]
        : []
    })
    const homeRows = homeCatalogSettings
      ? describeHomeRows(homeCatalogSettings, manifests, collectionSummaries)
      : []
    return NextResponse.json({
      user: auth.user,
      profiles,
      addons,
      plugins,
      collections,
      homeCatalogSettings,
      homeRows,
      selectedProfileId: pid,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 401 })
  }
}
