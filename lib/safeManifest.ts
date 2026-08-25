import { isIP } from 'node:net'

export const MAX_MANIFEST_BYTES = 512 * 1024
export const MANIFEST_FETCH_CONCURRENCY = 4
const MAX_MANIFEST_REDIRECTS = 3
const MANIFEST_TIMEOUT_MS = 8_000

export interface ManifestFetchOptions {
  fetchImpl?: typeof fetch
  maxBytes?: number
  maxRedirects?: number
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const numbers = parts.map(part => Number(part))
  return numbers.every((part, index) =>
    Number.isInteger(part) && part >= 0 && part <= 255 && String(part) === parts[index])
    ? numbers
    : null
}

function isPublicIpv4(address: string): boolean {
  const parts = parseIpv4(address)
  if (!parts) return false
  const [a, b, c] = parts
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 192 && b === 0) return false
  if (a === 192 && b === 2) return false
  if (a === 192 && b === 88 && c === 99) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if (a === 198 && b === 51 && c === 100) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}

function ipv6Words(address: string): number[] | null {
  let input = address.toLowerCase()
  if (input.includes('%')) return null
  if (input.includes('.')) {
    const lastColon = input.lastIndexOf(':')
    const ipv4 = parseIpv4(input.slice(lastColon + 1))
    if (!ipv4) return null
    input = `${input.slice(0, lastColon)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`
  }
  const halves = input.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null
  const raw = halves.length === 2 ? [...left, ...Array(missing).fill('0'), ...right] : left
  if (raw.length !== 8 || raw.some(part => !/^[0-9a-f]{1,4}$/.test(part))) return null
  return raw.map(part => Number.parseInt(part, 16))
}

function isPublicIpv6(address: string): boolean {
  const words = ipv6Words(address)
  if (!words) return false
  const [first, second] = words

  // Fail closed: manifests only need ordinary global unicast. This excludes
  // mapped/translated IPv4, loopback, ULA, link-local, multicast and NAT64.
  if ((first & 0xe000) !== 0x2000) return false

  // Reject special-purpose and transition space inside global unicast.
  if (first === 0x2001 && (second & 0xfe00) === 0) return false // 2001::/23
  if (first === 0x2001 && second === 0x0db8) return false // documentation
  if (first === 0x2002) return false // 6to4
  if (first === 0x3fff && (second & 0xf000) === 0) return false // 3fff::/20

  return true
}

export function isPublicIpAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, '')
  const family = isIP(normalized)
  if (family === 4) return isPublicIpv4(normalized)
  if (family === 6) return isPublicIpv6(normalized)
  return false
}

function validateManifestUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('Invalid manifest URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Manifest URL must use HTTP or HTTPS')
  }
  if (url.username || url.password) throw new Error('Manifest URL credentials are not allowed')

  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.home.arpa')) {
    throw new Error('Manifest hostname is blocked')
  }
  if (isIP(hostname) && !isPublicIpAddress(hostname)) {
    throw new Error('Manifest hostname is a private or reserved address')
  }
  return url
}

export async function readJsonResponseWithLimit(
  response: Response,
  maxBytes = MAX_MANIFEST_BYTES,
): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error('Manifest response is too large')
  }
  if (!response.body) throw new Error('Manifest response body is empty')

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error('Manifest response is too large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const combined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(combined))
  } catch {
    throw new Error('Manifest response is not valid JSON')
  }
}

export async function fetchManifestJson(
  input: string,
  options: ManifestFetchOptions = {},
): Promise<{ data: unknown; finalUrl: string }> {
  const fetchImpl = options.fetchImpl ?? fetch
  const maxBytes = options.maxBytes ?? MAX_MANIFEST_BYTES
  const maxRedirects = options.maxRedirects ?? MAX_MANIFEST_REDIRECTS
  let current = input

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const url = validateManifestUrl(current)
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'identity',
        'User-Agent': 'Nuvio-Account-Manager/1.0',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
    })

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error('Manifest redirect has no location')
      if (redirects === maxRedirects) throw new Error('Too many manifest redirects')
      current = new URL(location, url).toString()
      continue
    }
    if (!response.ok) throw new Error(`Manifest returned HTTP ${response.status}`)
    const data = await readJsonResponseWithLimit(response, maxBytes)
    return { data, finalUrl: url.toString() }
  }
  throw new Error('Too many manifest redirects')
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Concurrency limit must be positive')
  const results = new Array<R>(values.length)
  let nextIndex = 0
  const worker = async () => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= values.length) return
      results[index] = await mapper(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker))
  return results
}
