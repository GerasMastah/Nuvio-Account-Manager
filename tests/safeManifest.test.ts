import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchManifestJson,
  isPublicIpAddress,
  mapWithConcurrency,
  readJsonResponseWithLimit,
} from '../lib/safeManifest.ts'

test('rejects loopback, private, link-local and metadata IPs', () => {
  for (const address of [
    '127.0.0.1', '10.0.0.1', '172.16.1.1', '192.168.1.1',
    '169.254.169.254', '100.64.0.1', '::1', 'fc00::1', 'fe80::1',
    '::ffff:127.0.0.1', '::127.0.0.1', '100::1', '2001:2::1',
    '2001:10::1', '2001:20::1', '3fff::1', '5f00::1',
  ]) {
    assert.equal(isPublicIpAddress(address), false, address)
  }
  assert.equal(isPublicIpAddress('1.1.1.1'), true)
  assert.equal(isPublicIpAddress('2606:4700:4700::1111'), true)
})

test('rejects translated and IETF special IPv6 while preserving exact CIDR boundaries', () => {
  for (const address of [
    '2001:100::1',
    '::ffff:0:127.0.0.1',
    '3fff::1',
    '3fff:0fff:ffff:ffff:ffff:ffff:ffff:ffff',
  ]) {
    assert.equal(isPublicIpAddress(address), false, address)
  }

  for (const address of [
    '3ffe:ffff::1',
    '3fff:1000::1',
    '2606:4700:4700::1111',
  ]) {
    assert.equal(isPublicIpAddress(address), true, address)
  }
})

test('uses runtime public fetch and revalidates redirect destinations', async () => {
  let fetchCalls = 0
  const fetchImpl: typeof fetch = async (_input, init) => {
    fetchCalls += 1
    assert.equal(init?.redirect, 'manual')
    return new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/manifest.json' },
    })
  }
  await assert.rejects(
    fetchManifestJson('https://public.example/manifest.json', { fetchImpl }),
    /private|reserved|blocked/i,
  )
  assert.equal(fetchCalls, 1)
})

test('caps manifest response bodies even without content-length', async () => {
  const body = JSON.stringify({ id: 'x', padding: 'x'.repeat(2048) })
  const response = new Response(body, { headers: { 'content-type': 'application/json' } })
  await assert.rejects(readJsonResponseWithLimit(response, 256), /too large/i)
})

test('limits concurrent manifest work', async () => {
  let active = 0
  let maxActive = 0
  const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async value => {
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise(resolve => setTimeout(resolve, 5))
    active -= 1
    return value * 2
  })
  assert.deepEqual(results, [2, 4, 6, 8, 10])
  assert.equal(maxActive, 2)
})
