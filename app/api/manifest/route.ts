import { NextRequest, NextResponse } from 'next/server'
import { toManifestUrl } from '@/lib/homeRows'
import { fetchManifestJson } from '@/lib/safeManifest'

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json()
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL required' }, { status: 400 })
    }

    const manifestUrl = toManifestUrl(url)
    const { data: manifest, finalUrl } = await fetchManifestJson(manifestUrl)
    return NextResponse.json({ manifest, manifestUrl: finalUrl })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch manifest'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
