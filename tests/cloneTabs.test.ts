import test from 'node:test'
import assert from 'node:assert/strict'
import { firstAvailableCloneTab } from '../lib/cloneTabs.ts'

test('selects the first tab available on each newly loaded profile', () => {
  assert.equal(firstAvailableCloneTab({ addons: [{}], plugins: [], collections: [], homeRows: [] }), 'addons')
  assert.equal(firstAvailableCloneTab({ addons: [], plugins: [{}], collections: [], homeRows: [] }), 'plugins')
  assert.equal(firstAvailableCloneTab({ addons: [], plugins: [], collections: [{}], homeRows: [] }), 'collections')
  assert.equal(firstAvailableCloneTab({ addons: [], plugins: [], collections: [], homeRows: [{}] }), 'homeRows')
  assert.equal(firstAvailableCloneTab({
    addons: [], plugins: [], collections: [], homeRows: [], homeCatalogSettings: { items: [] },
  }), 'homeRows')
  assert.equal(firstAvailableCloneTab({ addons: [], plugins: [], collections: [], homeRows: [] }), 'addons')
})
