import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSource = readFileSync(join(__dirname, '..', 'client.js'), 'utf8')

function loadClientModule() {
  let loadedModule = null
  const fakeReact = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useRef: (init) => ({ current: init }),
    useCallback: (fn) => fn,
  }
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(mod) { loadedModule = mod },
      },
      addEventListener() {},
      removeEventListener() {},
    },
    console,
    setTimeout,
    clearTimeout,
    URLSearchParams,
  }
  vm.createContext(sandbox)
  vm.runInContext(clientSource, sandbox, { filename: 'client.js' })
  assert.ok(loadedModule && loadedModule.id === 'dsh-flowpack')
  const exportsObj = loadedModule.factory((id) => {
    if (id === 'react') return fakeReact
    throw new Error(`Unexpected client require: ${id}`)
  })
  return { exportsObj, fakeReact }
}

test('client.js v2 loads cleanly via DSH __ModuleLoader__ and registers sidebar, composer dock, hero options, overlay, and symmetrical locales', () => {
  const { exportsObj } = loadClientModule()
  const { __internals, inject, apply } = exportsObj

  assert.deepEqual([...inject], ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight'])
  assert.ok(__internals.zh['tab.capsules'] && __internals.en['tab.capsules'])
  assert.ok(__internals.zh['dock.pickLabel'] && __internals.en['dock.pickLabel'])

  const zhKeys = Object.keys(__internals.zh).sort()
  const enKeys = Object.keys(__internals.en).sort()
  assert.deepEqual(zhKeys, enKeys, 'zh and en locale dictionaries must stay 100% symmetrical')

  const referencedKeys = [...new Set([...clientSource.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)].map(m => m[1]))]
  const missingKeys = referencedKeys.filter(k => !__internals.zh[k] || !__internals.en[k])
  assert.deepEqual(missingKeys, [], 'all static locale keys referenced in client.js must exist in zh and en')

  const registeredTabs = []
  const registeredSlots = []
  const injectedSlotNames = []
  const registeredLocales = []
  const cleanupFns = []

  const mockCtx = {
    locale: {
      register(ns, dicts) { registeredLocales.push({ ns, dicts }) },
      bind(ns) { return (k) => __internals.zh[k] || `${ns}:${k}` },
    },
    sidebarRightTabs: {
      register(tabDef) {
        registeredTabs.push(tabDef)
        return () => {}
      },
    },
    sidebarRight: { openTab() {} },
    slots: {
      inject(slotName, fn) {
        injectedSlotNames.push(slotName)
        return fn()
      },
      register(meta, component) {
        registeredSlots.push({ meta, component })
        return () => {}
      },
    },
    effect(fn) {
      const d = fn()
      if (typeof d === 'function') cleanupFns.push(d)
      return d
    },
  }

  apply(mockCtx)

  assert.equal(registeredLocales.length, 1)
  assert.equal(registeredTabs.length, 1)
  assert.equal(registeredTabs[0].id, 'dsh-flowpack')
  assert.equal(registeredSlots.length, 8)

  const slotNames = registeredSlots.map(s => s.meta.name).sort()
  assert.deepEqual(slotNames, [
    'conversation.composer.dock',
    'conversation.hero.options',
    'conversation.input.left',
    'conversation.session.header.utilities',
    'settings.section',
    'shell.overlay',
    'sidebar.right.pane.tab',
    'sidebar.right.pane.tab.title',
  ])
  assert.equal(injectedSlotNames.length, 8, 'must use ctx.slots.inject when host exposes it')

  const useSessions = (sel) => sel({ byId: { 'sess-1': { id: 'sess-1', cwd: 'D:\\projects\\x', title: 'Test' } } })
  const t = (k) => __internals.zh[k] || k

  // Render main Panel element deterministically
  const panelSlot = registeredSlots.find(s => s.meta.name === 'sidebar.right.pane.tab')
  const renderedPanel = panelSlot.component({ sessionId: 'sess-1', useSessions, inputActions: {}, t })
  assert.equal(renderedPanel.type, 'div')
  assert.match(renderedPanel.props.className, /dfp-root/)

  // Render Composer Dock button & Hero option chip
  const dockSlot = registeredSlots.find(s => s.meta.name === 'conversation.composer.dock')
  const renderedDock = dockSlot.component({ sessionId: 'sess-1', useSessions, inputActions: {}, t })
  assert.equal(renderedDock.props.className, 'dfp-dock')

  const heroSlot = registeredSlots.find(s => s.meta.name === 'conversation.hero.options')
  const renderedHero = heroSlot.component({ sessionId: 'sess-1', useSessions, inputActions: {}, t })
  assert.equal(renderedHero.type, 'button')
  assert.match(renderedHero.props.className, /dfp-hero-pill/)

  for (const fn of cleanupFns) fn()
})
