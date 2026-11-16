/**
 * FlowPack (`dsh-flowpack`) — browser half.
 *
 * Human-friendly Experience Capsules, Strict Memory Notes, Self-Healing Rules,
 * Non-Forgetting Workflow History, and Cross-Platform Portability for DSH.
 */

window.__ModuleLoader__.load({
  id: 'dsh-flowpack',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback } = React

    const NS = 'flowpack'
    const KIND = 'flowpack'
    const ID = 'dsh-flowpack'

    /* ─────────────────────────── helpers & mappings ─────────────────────────── */

    function api(path, options) {
      const init = options || {}
      const headers = {
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(init.headers || {}),
      }
      return fetch(path, { ...init, headers }).then(async (response) => {
        if (response.status === 204) return { ok: true }
        const text = await response.text()
        let value
        try {
          value = text.length > 0 ? JSON.parse(text) : {}
        } catch {
          value = { ok: response.ok, error: text }
        }
        if (!response.ok || value.ok === false) {
          const err = new Error(value.error || `HTTP ${response.status}`)
          err.status = response.status
          throw err
        }
        return value
      })
    }

    function insertTextIntoComposer(inputActions, text) {
      if (!text) return false
      try {
        if (inputActions && typeof inputActions.captureInsertion === 'function' && typeof inputActions.insertText === 'function') {
          const span = inputActions.captureInsertion()
          if (inputActions.insertText(text, span)) return true
        }
      } catch {
        // Fall through to DOM fallback
      }
      if (typeof document === 'undefined' || typeof window === 'undefined') return false
      const editor = document.querySelector('[data-composer-card] [contenteditable="true"]')
        || document.querySelector('[contenteditable="true"]')
      if (!editor) return false
      try {
        editor.focus()
        const sel = window.getSelection()
        if (!sel) return false
        const range = document.createRange()
        range.selectNodeContents(editor)
        range.collapse(false)
        sel.removeAllRanges()
        sel.addRange(range)
        return document.execCommand('insertText', false, text)
      } catch {
        return false
      }
    }

    async function copyText(text) {
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch { /* fallback below */ }
      try {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.left = '-9999px'
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand('copy')
        area.remove()
        return ok
      } catch {
        return false
      }
    }

    function formatTime(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
      const d = new Date(ms)
      if (Number.isNaN(d.getTime())) return ''
      return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }

    function hostPrefersDark() {
      if (typeof document === 'undefined') return false
      const b = document.body
      const r = document.documentElement
      return Boolean(
        (b && (b.hasAttribute('data-ds-dark-theme') || b.classList.contains('dark')))
        || (r && (r.classList.contains('dark') || r.getAttribute('data-dfl-theme') === 'dark')),
      )
    }

    function useResolvedScheme(mode) {
      const [hostDark, setHostDark] = useState(hostPrefersDark)
      const [sysDark, setSysDark] = useState(() => (
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
          : false
      ))
      useEffect(() => {
        if (typeof window === 'undefined' || typeof document === 'undefined') return undefined
        const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : undefined
        const onMedia = (e) => setSysDark(Boolean(e?.matches))
        mq?.addEventListener?.('change', onMedia)
        const observer = typeof MutationObserver === 'function'
          ? new MutationObserver(() => setHostDark(hostPrefersDark()))
          : undefined
        observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-dfl-theme'] })
        if (document.body) observer?.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-ds-dark-theme'] })
        return () => {
          mq?.removeEventListener?.('change', onMedia)
          observer?.disconnect()
        }
      }, [])
      if (mode === 'dark' || mode === 'light') return mode
      if (mode === 'system') return sysDark ? 'dark' : 'light'
      return hostDark ? 'dark' : 'light'
    }

    function shortPathLabel(p) {
      if (!p) return ''
      const parts = String(p).replace(/\\/g, '/').split('/').filter(Boolean)
      return parts.length > 0 ? parts[parts.length - 1] : p
    }

    /* ─────────────────────────── SVG glyphs ─────────────────────────── */

    function FlowGlyph({ size = 16 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
      },
      h('rect', { x: 3.5, y: 4, width: 17, height: 16, rx: 5, fill: 'none', stroke: 'currentColor', strokeWidth: 1.75 }),
      h('path', { d: 'M8 13.5c1.5-4.2 3.2-4.2 4.3 0s2.5 4.2 3.7-2', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    function SparkIcon({ size = 14 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, style: { display: 'block', flex: 'none' } },
        h('path', { d: 'M12 3l2.1 5.9L20 11l-5.9 2.1L12 19l-2.1-5.9L4 11l5.9-2.1L12 3z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinejoin: 'round' }))
    }

    function ShieldIcon({ size = 13 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, style: { display: 'block', flex: 'none' } },
        h('path', { d: 'M12 3l7 3v5.5c0 4.5-3 8.3-7 9.5-4-1.2-7-5-7-9.5V6l7-3z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinejoin: 'round' }),
        h('path', { d: 'M9 12.2l2 2 4-4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    function RefreshIcon({ size = 14 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, style: { display: 'block', flex: 'none' } },
        h('path', { d: 'M20 11a8 8 0 1 0 2 5.3M20 4v7h-7', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    function HistoryIcon({ size = 14 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, style: { display: 'block', flex: 'none' } },
        h('path', { d: 'M3 12a9 9 0 1 0 3-6.7L3 8', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M3 3v5h5M12 7v5l3 2', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    function PlayIcon({ size = 13 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, style: { display: 'block', flex: 'none' } },
        h('path', { d: 'M7 5l12 7-12 7V5z', fill: 'currentColor' }))
    }

    function CloseIcon({ size = 14 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, style: { display: 'block', flex: 'none' } },
        h('path', { d: 'M6 6l12 12M18 6l-12 12', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' }))
    }

    /* ─────────────────────────── shared picker store ─────────────────────────── */

    function createCapsuleUiStore() {
      let state = {
        open: false,
        sessionId: '',
        cwd: '',
        inputActions: null,
        syncVersion: 0,
      }
      const listeners = new Set()
      const emit = () => { for (const fn of listeners) try { fn() } catch { /* ignore */ } }
      return {
        getState: () => state,
        subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
        openPicker: (ctxInfo = {}) => {
          state = {
            ...state,
            open: true,
            ...(ctxInfo.sessionId !== undefined ? { sessionId: ctxInfo.sessionId } : {}),
            ...(ctxInfo.cwd !== undefined ? { cwd: ctxInfo.cwd } : {}),
            ...(ctxInfo.inputActions !== undefined ? { inputActions: ctxInfo.inputActions } : {}),
          }
          emit()
        },
        closePicker: () => {
          if (!state.open) return
          state = { ...state, open: false }
          emit()
        },
        notifySync: () => {
          state = { ...state, syncVersion: state.syncVersion + 1 }
          emit()
        },
      }
    }

    const capsuleUi = createCapsuleUiStore()

    let _actCache = { key: '', syncVer: -1, promise: null, data: null }
    function fetchActivateLite(sessionId, cwd, syncVer) {
      const key = `${sessionId || ''}|${cwd || ''}`
      if (_actCache.key === key && _actCache.syncVer === syncVer) {
        if (_actCache.promise) return _actCache.promise
        if (_actCache.data) return Promise.resolve(_actCache.data)
      }
      const q = new URLSearchParams({ sessionId: sessionId || '', cwd: cwd || '', lite: '1' })
      const promise = api(`/api/flowpack.activate?${q.toString()}`)
        .then(data => {
          if (_actCache.key === key && _actCache.syncVer === syncVer) {
            _actCache.data = data
            _actCache.promise = null
          }
          return data
        })
        .catch(err => {
          if (_actCache.key === key && _actCache.syncVer === syncVer) _actCache.promise = null
          throw err
        })
      _actCache = { key, syncVer, promise, data: null }
      return promise
    }

    function useCapsuleUi() {
      const [, setTick] = useState(0)
      useEffect(() => capsuleUi.subscribe(() => setTick(x => x + 1)), [])
      return capsuleUi.getState()
    }

    /* ─────────────────────────── presentation helpers ─────────────────────────── */

    function renderMaturityMeter(cap, t) {
      const threshold = Math.max(1, cap.crystallizeThreshold || 3)
      const successes = Math.max(0, cap.successes || 0)
      const isCryst = cap.maturity === 'crystallized'
      const segments = Math.min(threshold, 5)
      const filled = isCryst ? segments : Math.min(segments, successes)
      const label = t(`maturity.${cap.maturity || 'exploring'}`)
      return h('div', { className: 'dfp-meter-wrap' },
        h('div', { className: 'dfp-meter-dots', 'aria-hidden': true },
          Array.from({ length: segments }).map((_, idx) =>
            h('span', { key: idx, className: `dfp-meter-dot ${idx < filled ? (isCryst ? 'is-cryst' : 'is-filled') : ''}` })),
        ),
        h('span', { className: `dfp-meter-label ${isCryst ? 'is-cryst' : ''}` },
          isCryst ? label : `${label} · ${Math.min(successes, threshold)}/${threshold}`))
    }

    function actionLabel(action, t) {
      if (action === 'init') return t('gen.action.init')
      if (action === 'reinforce') return t('gen.action.reinforce')
      if (action === 'self_heal') return t('gen.action.self_heal')
      if (action === 'restore') return t('gen.action.restore')
      if (action === 'optimize') return t('gen.action.optimize')
      return action || t('gen.action.init')
    }

    function trainStatusLabel(status, t) {
      if (status === 'watching') return t('train.status.watching')
      if (status === 'training') return t('train.status.training')
      if (status === 'graduated') return t('train.status.graduated')
      return t('train.status.ready')
    }

    function roundVerdictLabel(verdict, t) {
      if (verdict === 'accepted') return t('train.verdict.accepted')
      if (verdict === 'needs_fix') return t('train.verdict.needs_fix')
      if (verdict === 'ok_practice_more') return t('train.verdict.practice')
      return t('train.verdict.pending')
    }

    const KNOWN_PLUGIN_GROUPS = new Set(['office', 'excel', 'gui', 'workbuddy', 'fileLauncher', 'flowpack'])
    function pluginGroupName(id, t) {
      return KNOWN_PLUGIN_GROUPS.has(id) ? t(`plugin.${id}`) : id
    }

    function bucketFromToolName(toolName = '', phase = '') {
      const n = String(toolName || '').toLowerCase()
      if (n.includes('request_access') || n.includes('permission') || phase === 'prepare') return 'prepare'
      if (n.includes('computer') || n.includes('mouse') || n.includes('keyboard') || n.includes('open_application') || n.includes('focus') || n.includes('screenshot') || n.includes('gui') || phase === 'automate') return 'gui'
      if (n.includes('browser') || n.includes('web') || n.includes('fetch') || n.includes('curl') || n.includes('http')) return 'web'
      if (n.includes('excel') || n.includes('sheet') || n.includes('csv')) return 'spreadsheet'
      if (n.includes('office') || n.includes('word') || n.includes('docx') || n.includes('write') || n.includes('edit') || phase === 'edit') return 'document'
      if (n.includes('read') || n.includes('search') || n.includes('find') || n.includes('list') || n.includes('grep') || phase === 'discover') return 'discover'
      if (n.includes('test') || n.includes('verify') || n.includes('check') || phase === 'verify') return 'verify'
      return 'deliver'
    }

    function summarizeCapsuleForHuman(cap, t) {
      if (!cap) return { taskGoal: '', macroSteps: [], keyFixes: [], totalRawSteps: 0, fixCount: 0, headline: '' }
      const stages = cap.workflow?.stages || []
      const ls = cap.learnedSummary
      const totalRawSteps = cap.workflow?.totalRawSteps
        ?? ls?.totalRawSteps
        ?? stages.reduce((n, st) => n + (st.steps?.length || 0), 0)
      const rules = cap.selfHealing?.rules || []

      let macroSteps = Array.isArray(ls?.macroSteps) && ls.macroSteps.length > 0
        ? ls.macroSteps
        : []

      if (macroSteps.length === 0 && stages.length > 0) {
        const grouped = []
        for (const st of stages) {
          for (const step of (st.steps || [])) {
            const bucket = bucketFromToolName(step.tool, st.phase)
            const prev = grouped[grouped.length - 1]
            if (prev && prev.bucket === bucket) {
              prev.actionCount += 1
              if (!prev.tools.includes(step.tool)) prev.tools.push(step.tool)
              if (step.goal && prev.samples.length < 2 && !prev.samples.includes(step.goal)) prev.samples.push(step.goal)
            } else {
              grouped.push({
                bucket,
                label: t(`macro.${bucket}`),
                actionCount: 1,
                tools: [step.tool].filter(Boolean),
                samples: step.goal ? [step.goal] : [],
              })
            }
          }
        }
        macroSteps = grouped.slice(0, 6).map((g, i) => ({
          step: i + 1,
          label: g.label,
          summary: g.samples[0] || t('sum.stageOps', { count: g.actionCount, tools: g.tools.slice(0, 2).join(', ') || '-' }),
          actionCount: g.actionCount,
          tools: g.tools,
        }))
      }

      const rawDesc = String(cap.description || '').trim()
      const taskGoal = (ls?.taskGoal && String(ls.taskGoal).trim())
        || (rawDesc && !/the approval policy changed/i.test(rawDesc) ? rawDesc : cap.title)
      const keyFixes = Array.isArray(ls?.keyFixes) && ls.keyFixes.length > 0
        ? ls.keyFixes
        : rules.slice(0, 3).map(r => ({
          tool: r.tool || '*',
          problem: r.symptomPattern || '',
          fix: r.fixSteps || '',
        }))
      const fixCount = rules.length
      const headline = t('sum.headline', {
        macro: macroSteps.length || 1,
        raw: totalRawSteps || 1,
        fixes: fixCount,
      })

      return { taskGoal, macroSteps, keyFixes, totalRawSteps, fixCount, headline }
    }

    function summarizePackForHuman(pack, t) {
      if (!pack) return { totalEntries: 0, headline: '', highlights: [], scopeLabel: '' }
      if (pack.memorySummary && Array.isArray(pack.memorySummary.highlights)) {
        return pack.memorySummary
      }
      const sections = ['constraints', 'facts', 'decisions', 'pitfalls', 'workflows', 'checkpoints']
      const parts = []
      const highlights = []
      let totalEntries = 0
      for (const sec of sections) {
        const list = pack.entries?.[sec] || []
        totalEntries += list.length
        if (list.length > 0) parts.push(`${t(`sec.${sec}`)} ${list.length}`)
        for (const item of list.slice(0, 2)) {
          if (highlights.length < 4 && item?.text) {
            highlights.push({
              section: sec,
              sectionName: t(`sec.${sec}`),
              priority: item.priority || 'normal',
              text: item.text.length > 74 ? `${item.text.slice(0, 71)}...` : item.text,
            })
          }
        }
      }
      const scopeLabel = pack.scope === 'session'
        ? t('cap.scopeShort.session')
        : pack.scope === 'global'
          ? t('cap.scopeShort.global')
          : `${t('mem.workspaceLabel')}: ${shortPathLabel(pack.workspaceRoot) || '-'}`
      const headline = totalEntries > 0
        ? t('mem.sumHeadline', { count: totalEntries, parts: parts.join('、') || '-' })
        : t('mem.sumEmpty')
      return { totalEntries, headline, highlights, scopeLabel }
    }

    /* ─────────────────────────── main panel ─────────────────────────── */

    function createPanel(ctx) {
      return function FlowPackPanel(props) {
        const { sessionId, useSessions, inputActions, t } = props
        const cwd = useSessions ? (useSessions(state => state.byId?.[sessionId]?.cwd) || '') : ''
        const activeChatTitle = useSessions
          ? (useSessions(state => state.byId?.[sessionId]?.displayTitle || state.byId?.[sessionId]?.title) || '')
          : ''

        // 4 clean, human-first tabs: capsules | memory | train | advanced
        const [tab, setTab] = useState('capsules')
        const [advSubTab, setAdvSubTab] = useState('portability') // portability | injection | workflows
        const [capViewMode, setCapViewMode] = useState('list') // list | detail
        const [memViewMode, setMemViewMode] = useState('list') // list | detail
        const [trainViewMode, setTrainViewMode] = useState('list') // list | detail
        const [justLearnedCap, setJustLearnedCap] = useState(null)
        const [trainings, setTrainings] = useState([])
        const [watchSupported, setWatchSupported] = useState(true)
        const [activeWatchTrainId, setActiveWatchTrainId] = useState('')
        const [selectedTrainId, setSelectedTrainId] = useState(null)
        const [trainDetail, setTrainDetail] = useState(null)
        const [trainTitleInput, setTrainTitleInput] = useState('')
        const [trainGoalInput, setTrainGoalInput] = useState('')
        const [trainAutoQuestion, setTrainAutoQuestion] = useState(true)
        const [manualStepInput, setManualStepInput] = useState('')
        const [stepNoteDrafts, setStepNoteDrafts] = useState({})
        const [questionDrafts, setQuestionDrafts] = useState({})
        const [roundFeedbackInput, setRoundFeedbackInput] = useState('')
        const [expandedFrameSeq, setExpandedFrameSeq] = useState(null)
        const [justGraduated, setJustGraduated] = useState(null)
        const [editingTrainTitle, setEditingTrainTitle] = useState(false)
        const [trainRenameDraft, setTrainRenameDraft] = useState('')
        const [justSavedPack, setJustSavedPack] = useState(null)
        const [showMemGuide, setShowMemGuide] = useState(true)
        const [showNameInput, setShowNameInput] = useState(false)
        const [editingTitle, setEditingTitle] = useState(false)
        const [renameDraft, setRenameDraft] = useState('')
        const [showRawSteps, setShowRawSteps] = useState(false)
        const [showAllRaw, setShowAllRaw] = useState(false)
        const [rawCapDetail, setRawCapDetail] = useState(null)
        const [showExportBox, setShowExportBox] = useState(false)
        const [targetSessionId, setTargetSessionId] = useState(sessionId || '')
        const [settings, setSettings] = useState(null)
        const [hostSessions, setHostSessions] = useState([])
        const [workflows, setWorkflows] = useState([])
        const [selectedWfId, setSelectedWfId] = useState(null)
        const [artifactMode, setArtifactMode] = useState('stages')
        const [packs, setPacks] = useState([])
        const [quarantined, setQuarantined] = useState([])
        const [selectedPackId, setSelectedPackId] = useState(null)
        const [packDetail, setPackDetail] = useState(null)
        const [capsules, setCapsules] = useState([])
        const [activations, setActivations] = useState({ global: [], workspaces: {}, sessions: {} })
        const [activeResolved, setActiveResolved] = useState([])
        const [selectedCapsuleId, setSelectedCapsuleId] = useState(null)
        const [exportPreview, setExportPreview] = useState('')
        const [capSubView, setCapSubView] = useState('route') // route | selfheal | export
        const [capExportFmt, setCapExportFmt] = useState('dshcapsule')
        const [capTitleInput, setCapTitleInput] = useState('')
        const [showFixForm, setShowFixForm] = useState(false)
        const [fixTool, setFixTool] = useState('')
        const [fixSymptom, setFixSymptom] = useState('')
        const [fixResolution, setFixResolution] = useState('')
        const [capabilities, setCapabilities] = useState(null)
        const [healEvents, setHealEvents] = useState([])
        const [injection, setInjection] = useState(null)
        const [busy, setBusy] = useState(false)
        const [toast, setToast] = useState('')
        const [customTitle, setCustomTitle] = useState('')
        const [guardrailInput, setGuardrailInput] = useState('')
        const [pinSection, setPinSection] = useState('constraints')
        const [pinPriority, setPinPriority] = useState('high')
        const [pinScope, setPinScope] = useState('workspace')
        const [pinText, setPinText] = useState('')
        const [importJson, setImportJson] = useState('')
        const timerRef = useRef(null)
        const prevSessionIdRef = useRef(sessionId || '')
        const uiState = useCapsuleUi()

        const scheme = useResolvedScheme(settings?.appearanceTheme || 'host')

        const notify = useCallback((msg) => {
          setToast(msg)
          clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => setToast(''), 3400)
        }, [])

        useEffect(() => {
          const next = sessionId || ''
          if (next && (next !== prevSessionIdRef.current || !targetSessionId)) {
            prevSessionIdRef.current = next
            setTargetSessionId(next)
          }
        }, [sessionId, targetSessionId])

        const effectiveSessionId = targetSessionId || sessionId || ''

        const loadAll = useCallback(async () => {
          try {
            const [sRes, pkRes, sesRes, capRes, actRes, trRes] = await Promise.all([
              api('/api/flowpack.settings'),
              api('/api/flowpack.packs'),
              api('/api/flowpack.sessions?limit=50').catch(() => ({ sessions: [] })),
              api('/api/flowpack.capsules?summary=1').catch(() => ({ capsules: [], activations: { global: [], workspaces: {}, sessions: {} } })),
              fetchActivateLite(effectiveSessionId, cwd, uiState.syncVersion).catch(() => ({ resolved: [] })),
              api('/api/flowpack.train').catch(() => ({ supported: true, trainings: [] })),
            ])
            setSettings(sRes.settings)
            setPacks(Array.isArray(pkRes.packs) ? pkRes.packs : [])
            setQuarantined(Array.isArray(pkRes.quarantined) ? pkRes.quarantined : [])
            if (Array.isArray(sesRes.sessions)) setHostSessions(sesRes.sessions)
            setCapsules(Array.isArray(capRes.capsules) ? capRes.capsules : [])
            if (capRes.activations) setActivations(capRes.activations)
            setActiveResolved(Array.isArray(actRes.resolved) ? actRes.resolved : [])
            if (typeof trRes.supported === 'boolean') setWatchSupported(trRes.supported)
            if (typeof trRes.activeWatchTrainId === 'string') setActiveWatchTrainId(trRes.activeWatchTrainId)
            if (Array.isArray(trRes.trainings)) setTrainings(trRes.trainings)
          } catch (err) {
            notify(err.message)
          }
        }, [notify, effectiveSessionId, cwd, uiState.syncVersion])

        const loadInjection = useCallback(async () => {
          try {
            const q = new URLSearchParams({ sessionId: effectiveSessionId, cwd: cwd || '' })
            const res = await api(`/api/flowpack.preview-injection?${q.toString()}`)
            setInjection(res.injection)
          } catch { /* ignore */ }
        }, [effectiveSessionId, cwd])

        useEffect(() => { void loadAll() }, [loadAll])

        // Lazy-load secondary endpoints ONLY when user visits those specific views
        useEffect(() => {
          if (tab !== 'advanced') return
          if (advSubTab === 'injection') void loadInjection()
          if (advSubTab === 'workflows') {
            api('/api/flowpack.workflows?summary=1')
              .then(r => setWorkflows(Array.isArray(r.workflows) ? r.workflows : []))
              .catch(() => {})
          }
        }, [tab, advSubTab, loadInjection, capsules, packs])

        useEffect(() => {
          if (!(capViewMode === 'detail' && capSubView === 'selfheal')) return
          api('/api/flowpack.capabilities')
            .then(u => {
              if (u.capabilities) setCapabilities(u.capabilities)
              if (Array.isArray(u.healEvents)) setHealEvents(u.healEvents)
            })
            .catch(() => {})
        }, [capViewMode, capSubView, selectedCapsuleId])

        useEffect(() => {
          if (!(capViewMode === 'detail' && showRawSteps && selectedCapsuleId)) {
            setRawCapDetail(null)
            return
          }
          api(`/api/flowpack.capsules?capsuleId=${encodeURIComponent(selectedCapsuleId)}`)
            .then(r => setRawCapDetail(r.capsule || null))
            .catch(() => setRawCapDetail(null))
        }, [capViewMode, showRawSteps, selectedCapsuleId])

        useEffect(() => {
          const wantExport = (tab === 'capsules' && capViewMode === 'detail' && capSubView === 'selfheal' && showExportBox)
            || (tab === 'advanced' && advSubTab === 'portability')
          if (!wantExport || !selectedCapsuleId) return
          const fmtParam = capExportFmt === 'agentsMd' ? 'agents_md' : capExportFmt
          api(`/api/flowpack.capsules?capsuleId=${encodeURIComponent(selectedCapsuleId)}&format=${encodeURIComponent(fmtParam)}`)
            .then(r => setExportPreview(r.exported || ''))
            .catch(() => setExportPreview(''))
        }, [tab, capViewMode, capSubView, showExportBox, advSubTab, selectedCapsuleId, capExportFmt])

        useEffect(() => {
          if (!(tab === 'memory' && memViewMode === 'detail' && selectedPackId)) {
            setPackDetail(null)
            return
          }
          api(`/api/flowpack.packs?packId=${encodeURIComponent(selectedPackId)}`)
            .then(setPackDetail)
            .catch(() => setPackDetail(null))
        }, [tab, memViewMode, selectedPackId, packs])

        useEffect(() => {
          if (!(tab === 'train' && trainViewMode === 'detail' && selectedTrainId)) {
            if (!selectedTrainId) setTrainDetail(null)
            return
          }
          let cancelled = false
          const fetchDetail = () => {
            api(`/api/flowpack.train?trainId=${encodeURIComponent(selectedTrainId)}`)
              .then(r => { if (!cancelled && r.training) setTrainDetail(r.training) })
              .catch(() => { if (!cancelled) setTrainDetail(null) })
          }
          fetchDetail()
          return () => { cancelled = true }
        }, [tab, trainViewMode, selectedTrainId, trainings])

        // Only poll every 1800ms while actively watching user's screen inside detail view
        useEffect(() => {
          if (!(tab === 'train' && trainViewMode === 'detail' && selectedTrainId && trainDetail?.status === 'watching')) return
          const id = setInterval(() => {
            api(`/api/flowpack.train?trainId=${encodeURIComponent(selectedTrainId)}`)
              .then(r => { if (r.training) setTrainDetail(r.training) })
              .catch(() => {})
          }, 1800)
          return () => clearInterval(id)
        }, [tab, trainViewMode, selectedTrainId, trainDetail?.status])

        const activeWorkflow = useMemo(
          () => workflows.find(w => w.workflowId === selectedWfId) || workflows[0] || null,
          [workflows, selectedWfId],
        )
        const activePack = useMemo(
          () => packs.find(p => p.packId === selectedPackId) || packs[0] || null,
          [packs, selectedPackId],
        )
        const activeTraining = useMemo(
          () => trainings.find(x => x.trainId === selectedTrainId) || trainings[0] || null,
          [trainings, selectedTrainId],
        )
        const activeCapsule = useMemo(
          () => capsules.find(c => c.capsuleId === selectedCapsuleId) || capsules[0] || null,
          [capsules, selectedCapsuleId],
        )

        useEffect(() => {
          if (!selectedCapsuleId && capsules.length > 0) setSelectedCapsuleId(capsules[0].capsuleId)
        }, [capsules, selectedCapsuleId])
        useEffect(() => {
          if (!selectedWfId && workflows.length > 0) setSelectedWfId(workflows[0].workflowId)
        }, [workflows, selectedWfId])
        useEffect(() => {
          if (!selectedPackId && packs.length > 0) setSelectedPackId(packs[0].packId)
        }, [packs, selectedPackId])
        useEffect(() => {
          setEditingTitle(false)
          setShowRawSteps(false)
          setShowAllRaw(false)
          setRawCapDetail(null)
          setShowExportBox(false)
          setExportPreview('')
        }, [selectedCapsuleId])

        const recapByCapId = useMemo(() => {
          const map = new Map()
          for (const c of capsules) {
            map.set(c.capsuleId, summarizeCapsuleForHuman(c, t))
          }
          return map
        }, [capsules, t])

        const packSummaryById = useMemo(() => {
          const map = new Map()
          for (const p of packs) {
            map.set(p.packId, summarizePackForHuman(p, t))
          }
          return map
        }, [packs, t])

        const mergedSessionOptions = useMemo(() => {
          const map = new Map()
          if (sessionId) {
            map.set(sessionId, { id: sessionId, title: activeChatTitle || t('msg.unnamedSession'), cwd })
          }
          for (const r of hostSessions) {
            if (!map.has(r.sessionId)) map.set(r.sessionId, { id: r.sessionId, title: r.title || t('msg.unnamedSession'), cwd: r.cwd || '' })
          }
          return [...map.values()]
        }, [sessionId, activeChatTitle, cwd, hostSessions, t])

        /* ── Actions: Capsules ── */
        const handleLearnCapsule = async (forceCrystallize = false) => {
          if (!effectiveSessionId) return notify(t('msg.noSession'))
          setBusy(true)
          try {
            const res = await api('/api/flowpack.capsules', {
              method: 'POST',
              body: JSON.stringify({
                action: forceCrystallize ? 'crystallize' : 'learn',
                sessionId: effectiveSessionId,
                ...(capTitleInput.trim() ? { title: capTitleInput.trim() } : {}),
                crystallize: forceCrystallize,
                activate: forceCrystallize,
              }),
            })
            setCapTitleInput('')
            setShowNameInput(false)
            setSelectedCapsuleId(res.capsule.capsuleId)
            setJustLearnedCap(res.capsule)
            capsuleUi.notifySync()
            notify(t('msg.capLearned', { title: res.capsule.title, attempts: res.capsule.attempts }))
            await loadAll()
          } catch (err) {
            notify(err.message)
          } finally {
            setBusy(false)
          }
        }

        const handleRenameCapsule = async (capId, nextTitle) => {
          const trimmed = String(nextTitle || '').trim()
          if (!trimmed) return notify(t('msg.emptyName'))
          setBusy(true)
          try {
            const res = await api('/api/flowpack.capsules', {
              method: 'POST',
              body: JSON.stringify({ action: 'rename', capsuleId: capId, title: trimmed }),
            })
            setEditingTitle(false)
            setRenameDraft('')
            if (justLearnedCap?.capsuleId === capId) setJustLearnedCap(res.capsule)
            capsuleUi.notifySync()
            notify(t('msg.renamed', { title: res.capsule.title }))
            await loadAll()
          } catch (err) {
            notify(err.message)
          } finally {
            setBusy(false)
          }
        }

        const handleRefreshFromSession = async (cap) => {
          if (!effectiveSessionId) return notify(t('msg.noSession'))
          setBusy(true)
          try {
            const isCryst = cap.maturity === 'crystallized'
            const isMounted = activeResolved.some(r => r.capsuleId === cap.capsuleId)
            const res = await api('/api/flowpack.capsules', {
              method: 'POST',
              body: JSON.stringify({
                action: isCryst ? 'crystallize' : 'learn',
                capsuleId: cap.capsuleId,
                sessionId: effectiveSessionId,
                crystallize: isCryst,
                activate: isMounted,
              }),
            })
            setJustLearnedCap(res.capsule)
            capsuleUi.notifySync()
            notify(t('msg.refreshedCap', { title: res.capsule.title }))
            await loadAll()
          } catch (err) {
            notify(err.message)
          } finally {
            setBusy(false)
          }
        }

        const handleToggleCapsuleScope = async (capId, targetScope) => {
          setBusy(true)
          try {
            await api('/api/flowpack.activate', {
              method: 'POST',
              body: JSON.stringify({
                action: 'toggle',
                capsuleId: capId,
                scope: targetScope,
                sessionId: effectiveSessionId,
                cwd: cwd || '',
                inheritSubagents: true,
              }),
            })
            capsuleUi.notifySync()
            notify(t('msg.capToggled', { scope: t(`cap.scope.${targetScope}`) }))
            await loadAll()
          } catch (err) {
            notify(err.message)
          } finally {
            setBusy(false)
          }
        }

        const handleDeactivateAll = async (capId) => {
          setBusy(true)
          try {
            await api('/api/flowpack.activate', {
              method: 'POST',
              body: JSON.stringify({
                action: 'deactivate',
                capsuleId: capId,
                scope: 'all',
                sessionId: effectiveSessionId,
                cwd: cwd || '',
              }),
            })
            capsuleUi.notifySync()
            notify(t('msg.capDisarmed'))
            await loadAll()
          } catch (err) {
            notify(err.message)
          } finally {
            setBusy(false)
          }
        }

        const handleCrystallizeCapsule = async (capId) => {
          setBusy(true)
          try {
            await api('/api/flowpack.capsules', {
              method: 'POST',
              body: JSON.stringify({ action: 'crystallize', capsuleId: capId, activate: true, sessionId: effectiveSessionId, cwd: cwd || '' }),
            })
            capsuleUi.notifySync()
            notify(t('msg.capCrystallized'))
            await loadAll()
          } catch (err) {
            notify(err.message)
          } finally {
            setBusy(false)
          }
        }

        const handleRecordProblemFix = async (capId) => {
          if (!fixSymptom.trim() || !fixResolution.trim()) return
          setBusy(true)
          try {
            await api('/api/flowpack.capsules', {
              method: 'POST',
              body: JSON.stringify({
                action: 'learn_fix',
                capsuleId: capId,
                tool: fixTool.trim() || '*',
                symptom: fixSymptom.trim(),
                resolution: fixResolution.trim(),
                sessionId: effectiveSessionId,
              }),
            })
            setFixTool('')
            setFixSymptom('')
            setFixResolution('')
            setShowFixForm(false)
            capsuleUi.notifySync()
            notify(t('msg.fixRecorded'))
            await loadAll()
          } catch (err) {
            notify(err.message)
          } finally {
            setBusy(false)
          }
        }

        const handleRestoreGeneration = async (capId, gen) => {
          setBusy(true)
          try {
            await api('/api/flowpack.capsules', {
              method: 'POST',
              body: JSON.stringify({ action: 'restore_gen', capsuleId: capId, gen }),
            })
            capsuleUi.notifySync()
            notify(t('msg.genRestored', { gen }))
            await loadAll()
          } catch (err) {
            notify(err.message)
          } finally {
            setBusy(false)
          }
        }

        const handleDeleteCapsule = async (capId) => {
          setBusy(true)
          try {
            await api('/api/flowpack.capsules', {
              method: 'POST',
              body: JSON.stringify({ action: 'delete', capsuleId: capId }),
            })
            setSelectedCapsuleId(null)
            if (justLearnedCap?.capsuleId === capId) setJustLearnedCap(null)
            setCapViewMode('list')
            capsuleUi.notifySync()
            notify(t('msg.deleted'))
            await loadAll()
          } catch (err) {
            notify(err.message)
          } finally {
            setBusy(false)
          }
        }

        /* ── Actions: Workflows & Memory ── */
        const handleDistill = async () => {
          if (!effectiveSessionId) return notify(t('msg.noSession'))
          setBusy(true)
          try {
            const res = await api('/api/flowpack.workflows', {
              method: 'POST',
              body: JSON.stringify({
                action: 'distill',
                sessionId: effectiveSessionId,
                ...(customTitle.trim() ? { title: customTitle.trim() } : {}),
              }),
            })
            setCustomTitle('')
            setSelectedWfId(res.workflow.workflowId)
            notify(t('msg.distilled', { name: res.workflow.title, score: res.workflow.optimized?.metrics?.afterScore ?? 0 }))
            await loadAll()
          } catch (err) {
            notify(err.message)
          } finally {
            setBusy(false)
          }
        }

        const handleOptimize = async (wfId) => {
          setBusy(true)
          try {
            const res = await api('/api/flowpack.workflows', {
              method: 'POST',
              body: JSON.stringify({
                action: 'optimize',
                workflowId: wfId,
                ...(guardrailInput.trim() ? { addGuardrail: guardrailInput.trim() } : {}),
              }),
            })
            setGuardrailInput('')
            notify(t('msg.optimized', { ver: res.workflow.version }))
            await loadAll()
          } catch (err) {
            notify(err.message)
          } finally {
            setBusy(false)
          }
        }

        const handlePromoteToggle = async (wf) => {
          setBusy(true)
          try {
            await api('/api/flowpack.workflows', {
              method: 'POST',
              body: JSON.stringify({ action: 'promote', workflowId: wf.workflowId, promote: !wf.promotedAsSkill }),
            })
            notify(wf.promotedAsSkill ? t('msg.demoted') : t('msg.promoted'))
            await loadAll()
          } catch (err) {
            notify(err.message)
          } finally {
            setBusy(false)
          }
        }

        const handleDeleteWorkflow = async (wfId) => {
          setBusy(true)
          try {
            await api('/api/flowpack.workflows', {
              method: 'POST',
              body: JSON.stringify({ action: 'delete', workflowId: wfId }),
            })
            setSelectedWfId(null)
            notify(t('msg.deleted'))
            await loadAll()
          } catch (err) {
            notify(err.message)
          } finally {
            setBusy(false)
          }
        }

        const handlePackSession = async () => {
          if (!effectiveSessionId) return notify(t('msg.noSession'))
          setBusy(true)
          try {
            const res = await api('/api/flowpack.packs', {
              method: 'POST',
              body: JSON.stringify({ action: 'pack', sessionId: effectiveSessionId, seal: true }),
            })
            setSelectedPackId(res.pack.packId)
            setJustSavedPack({ pack: res.pack, memorySummary: res.memorySummary })
            notify(t('msg.packed', { title: res.pack.title }))
            await loadAll()
          } catch (err) {
            notify(err.message)
          } finally {
            setBusy(false)
          }
        }

        const handlePinEntry = async () => {
          if (!pinText.trim()) return
          setBusy(true)
          try {
            const res = await api('/api/flowpack.packs', {
              method: 'POST',
              body: JSON.stringify({
                action: 'pin',
                packId: activePack?.packId,
                scope: activePack ? activePack.scope : pinScope,
                cwd: cwd || '',
                sessionId: effectiveSessionId,
                section: pinSection,
                priority: pinPriority,
                text: pinText.trim(),
                seal: true,
              }),
            })
            setPinText('')
            setSelectedPackId(res.pack.packId)
            setJustSavedPack({ pack: res.pack, memorySummary: res.memorySummary })
            notify(t('msg.pinned'))
            await loadAll()
          } catch (err) {
            notify(err.message)
          } finally {
            setBusy(false)
          }
        }

        const handleDeletePack = async (packId) => {
          setBusy(true)
          try {
            await api('/api/flowpack.packs', {
              method: 'POST',
              body: JSON.stringify({ action: 'delete', packId }),
            })
            setSelectedPackId(null)
            if (justSavedPack?.pack?.packId === packId) setJustSavedPack(null)
            setMemViewMode('list')
            notify(t('msg.deleted'))
            await loadAll()
          } catch (err) {
            notify(err.message)
          } finally {
            setBusy(false)
          }
        }

        const handleVerifyAll = async () => {
          setBusy(true)
          try {
            const res = await api('/api/flowpack.packs', {
              method: 'POST',
              body: JSON.stringify({ action: 'verify', sessionId: effectiveSessionId, cwd: cwd || '' }),
            })
            const r = res.report
            notify(t('msg.verified', { passed: r.passed, failed: r.failed, q: r.quarantinedNow?.length || 0 }))
            await loadAll()
          } catch (err) {
            notify(err.message)
          } finally {
            setBusy(false)
          }
        }

        const handleSealPack = async (packId) => {
          setBusy(true)
          try {
            await api('/api/flowpack.packs', { method: 'POST', body: JSON.stringify({ action: 'seal', packId }) })
            notify(t('msg.sealed'))
            await loadAll()
          } catch (err) {
            notify(err.message)
          } finally {
            setBusy(false)
          }
        }

        const handleRollbackPack = async (packId, version) => {
          setBusy(true)
          try {
            await api('/api/flowpack.packs', { method: 'POST', body: JSON.stringify({ action: 'rollback', packId, version }) })
            notify(t('msg.rolledBack', { ver: version }))
            await loadAll()
          } catch (err) {
            notify(err.message)
          } finally {
            setBusy(false)
          }
        }

        const handleImportBundle = async () => {
          if (!importJson.trim()) return
          setBusy(true)
          try {
            const trimmed = importJson.trim()
            const parsed = JSON.parse(trimmed)
            if (parsed && parsed.schemaVersion === 'dsh-experience-capsule/v2') {
              const res = await api('/api/flowpack.capsules', {
                method: 'POST',
                body: JSON.stringify({ action: 'import', bundle: parsed }),
              })
              setImportJson('')
              setSelectedCapsuleId(res.capsule.capsuleId)
              setTab('capsules')
              capsuleUi.notifySync()
              notify(t('msg.imported', { title: res.capsule.title }))
              await loadAll()
            } else {
              const res = await api('/api/flowpack.packs', {
                method: 'POST',
                body: JSON.stringify({ action: 'import', bundleJson: trimmed }),
              })
              setImportJson('')
              setSelectedPackId(res.pack.packId)
              setTab('memory')
              notify(t('msg.imported', { title: res.pack.title }))
              await loadAll()
            }
          } catch (err) {
            notify(err.message)
          } finally {
            setBusy(false)
          }
        }

        /* ── Actions: Watch & Train (Apprenticeship) ── */
        const runTrainAction = async (payload, onSuccess) => {
          setBusy(true)
          try {
            const res = await api('/api/flowpack.train', {
              method: 'POST',
              body: JSON.stringify(payload),
            })
            if (res.training) setTrainDetail(res.training)
            await onSuccess?.(res)
            await loadAll()
            return res
          } catch (err) {
            notify(err.message)
            return null
          } finally {
            setBusy(false)
          }
        }

        const handleStartWatch = async (manualOnly = false) => {
          setBusy(true)
          try {
            const res = await api('/api/flowpack.train', {
              method: 'POST',
              body: JSON.stringify({
                action: 'start_watch',
                title: trainTitleInput.trim(),
                goal: trainGoalInput.trim(),
                cwd: cwd || '',
                sessionId: effectiveSessionId,
                autoQuestion: trainAutoQuestion,
              }),
            })
            let finalTraining = res.training
            if (manualOnly && finalTraining?.trainId) {
              const stopped = await api('/api/flowpack.train', {
                method: 'POST',
                body: JSON.stringify({ action: 'stop_watch', trainId: finalTraining.trainId }),
              })
              if (stopped.training) finalTraining = stopped.training
            }
            if (finalTraining) {
              setSelectedTrainId(finalTraining.trainId)
              setTrainDetail(finalTraining)
              setTrainViewMode('detail')
            }
            setTrainTitleInput('')
            setTrainGoalInput('')
            setJustGraduated(null)
            setExpandedFrameSeq(null)
            if (manualOnly) notify(t('msg.trainCreated'))
            else if (res.driverWarning) notify(t('msg.trainWatchFallback', { warn: res.driverWarning }))
            else notify(t('msg.trainWatching'))
            await loadAll()
          } catch (err) {
            notify(err.message)
          } finally {
            setBusy(false)
          }
        }

        const handleCaptureNow = () => selectedTrainId && runTrainAction(
          { action: 'capture_now', trainId: selectedTrainId },
          (res) => notify(res.raisedQuestion ? t('msg.trainQuestionRaised') : t('msg.trainCaptured')),
        )

        const handleStopWatch = () => selectedTrainId && runTrainAction(
          { action: 'stop_watch', trainId: selectedTrainId },
          () => notify(t('msg.trainStopped')),
        )

        const handleAddManualStep = () => {
          if (!selectedTrainId || !manualStepInput.trim()) return
          const summary = manualStepInput.trim()
          return runTrainAction(
            { action: 'add_step', trainId: selectedTrainId, summary },
            () => {
              setManualStepInput('')
              notify(t('msg.trainStepAdded'))
            },
          )
        }

        const handleSaveStepNote = (stepSeq) => {
          if (!selectedTrainId) return
          const note = stepNoteDrafts[stepSeq] ?? ''
          return runTrainAction(
            { action: 'step_note', trainId: selectedTrainId, stepSeq, note },
            () => notify(t('msg.trainNoteSaved')),
          )
        }

        const handleDeleteDemoStep = (stepSeq) => selectedTrainId && runTrainAction(
          { action: 'delete_step', trainId: selectedTrainId, stepSeq },
          () => notify(t('msg.deleted')),
        )

        const handleAiReview = () => selectedTrainId && runTrainAction(
          { action: 'ai_review', trainId: selectedTrainId },
          (res) => notify(res.ok ? t('msg.trainAiReviewed') : (res.reason || t('msg.trainAiReviewUnavailable'))),
        )

        const handleAnswerQuestion = (qId, skip = false) => {
          if (!selectedTrainId) return
          const ans = String(questionDrafts[qId] || '').trim()
          if (!skip && !ans) return notify(t('msg.emptyName'))
          return runTrainAction(
            { action: 'answer_question', trainId: selectedTrainId, qId, answer: ans, skip },
            () => {
              setQuestionDrafts(prev => { const next = { ...prev }; delete next[qId]; return next })
              notify(t(skip ? 'msg.trainQuestionSkipped' : 'msg.trainQuestionAnswered'))
            },
          )
        }

        const handleRenameTrain = () => {
          if (!selectedTrainId || !trainRenameDraft.trim()) return notify(t('msg.emptyName'))
          return runTrainAction(
            { action: 'rename', trainId: selectedTrainId, title: trainRenameDraft.trim() },
            (res) => {
              setEditingTrainTitle(false)
              notify(t('msg.renamed', { title: res.training?.title || trainRenameDraft.trim() }))
            },
          )
        }

        const handleStartTrainingRound = (mode = 'practice') => {
          if (!selectedTrainId) return
          const note = roundFeedbackInput.trim()
          return runTrainAction(
            {
              action: 'prepare_round',
              trainId: selectedTrainId,
              sessionId: effectiveSessionId,
              cwd: cwd || '',
              feedbackNote: note,
              mode,
            },
            async (res) => {
              setRoundFeedbackInput('')
              if (res.prompt) await sendToComposer(res.prompt)
              notify(t('msg.trainRoundPrepared', { no: res.roundNo || '?' }))
            },
          )
        }

        const handleRecordRoundFromChat = () => {
          if (!selectedTrainId || !effectiveSessionId) return notify(t('msg.noSession'))
          return runTrainAction(
            { action: 'record_round', trainId: selectedTrainId, sessionId: effectiveSessionId },
            () => notify(t('msg.trainRoundRecorded')),
          )
        }

        const handleAnnotateRound = (roundNo, verdict, prepareNext = false) => {
          if (!selectedTrainId) return
          const note = roundFeedbackInput.trim()
          return runTrainAction(
            {
              action: 'annotate_round',
              trainId: selectedTrainId,
              roundNo,
              verdict,
              note,
              prepareNext,
              sessionId: effectiveSessionId,
              cwd: cwd || '',
            },
            async (res) => {
              setRoundFeedbackInput('')
              if (prepareNext && res.nextPrompt) {
                await sendToComposer(res.nextPrompt)
                notify(t('msg.trainNextRoundReady'))
              } else {
                notify(t('msg.trainAnnotated'))
              }
            },
          )
        }

        const handleGraduateTraining = () => {
          if (!selectedTrainId) return
          return runTrainAction(
            {
              action: 'graduate',
              trainId: selectedTrainId,
              scope: cwd ? 'workspace' : 'global',
              inheritSubagents: true,
            },
            (res) => {
              setJustGraduated({ capsule: res.capsule, pack: res.pack, memorySummary: res.memorySummary })
              capsuleUi.notifySync()
              notify(t('msg.trainGraduated', { title: res.capsule?.title || res.training?.title || '' }))
            },
          )
        }

        const handleResumeWatch = (trainId) => trainId && runTrainAction(
          {
            action: 'start_watch',
            trainId,
            cwd: cwd || '',
            sessionId: effectiveSessionId,
            autoQuestion: trainDetail?.autoQuestion !== false,
          },
          (res) => {
            if (res.driverWarning) notify(t('msg.trainWatchFallback', { warn: res.driverWarning }))
            else notify(t('msg.trainWatching'))
          },
        )

        const handleAcceptAndGraduate = async (roundNo) => {
          if (!selectedTrainId) return
          setBusy(true)
          try {
            const note = roundFeedbackInput.trim()
            await api('/api/flowpack.train', {
              method: 'POST',
              body: JSON.stringify({
                action: 'annotate_round',
                trainId: selectedTrainId,
                roundNo,
                verdict: 'accepted',
                note,
                prepareNext: false,
              }),
            })
            const grad = await api('/api/flowpack.train', {
              method: 'POST',
              body: JSON.stringify({
                action: 'graduate',
                trainId: selectedTrainId,
                scope: cwd ? 'workspace' : 'global',
                inheritSubagents: true,
              }),
            })
            if (grad.training) setTrainDetail(grad.training)
            setRoundFeedbackInput('')
            setJustGraduated({ capsule: grad.capsule, pack: grad.pack, memorySummary: grad.memorySummary })
            capsuleUi.notifySync()
            notify(t('msg.trainGraduated', { title: grad.capsule?.title || grad.training?.title || '' }))
            await loadAll()
          } catch (err) {
            notify(err.message)
          } finally {
            setBusy(false)
          }
        }

        const handleDeleteTraining = (trainId) => runTrainAction(
          { action: 'delete', trainId },
          () => {
            if (selectedTrainId === trainId) {
              setSelectedTrainId(null)
              setTrainDetail(null)
              setTrainViewMode('list')
            }
            setJustGraduated(null)
            notify(t('msg.deleted'))
          },
        )

        const isCapsuleBoundInScope = (capId, targetScope) => {
          if (!activations) return false
          if (targetScope === 'global') return (activations.global || []).some(b => b.capsuleId === capId)
          if (targetScope === 'session') return (activations.sessions?.[effectiveSessionId] || []).some(b => b.capsuleId === capId)
          return Object.values(activations.workspaces || {}).some(list => list.some(b => b.capsuleId === capId))
        }

        const sendToComposer = async (content) => {
          const inserted = insertTextIntoComposer(inputActions, content)
          if (inserted) return notify(t('msg.inserted'))
          const copied = await copyText(content)
          notify(copied ? t('msg.copied') : t('msg.copyFailed'))
        }

        const handleSelectAndStartCapsule = async (cap) => {
          if (!activeResolved.some(r => r.capsuleId === cap.capsuleId)) {
            await handleToggleCapsuleScope(cap.capsuleId, cap.workspaceRoot ? 'workspace' : 'global')
          }
          await sendToComposer(cap.executionPreset?.starterPrompt || `使用经验胶囊「${cap.title}」执行任务`)
        }

        /* ─────────────────────────── render ─────────────────────────── */

        const rootAttrs = { 'data-dfp-scheme': scheme }

        return h('div', { className: 'dfp-root dfp-theme', ...rootAttrs },
          /* Header */
          h('div', { className: 'dfp-header' },
            h('div', { className: 'dfp-header-top' },
              h('div', { className: 'dfp-brand' },
                h('div', { className: 'dfp-brand-mark' }, h(FlowGlyph, { size: 15 })),
                h('div', { className: 'dfp-brand-text' },
                  h('span', { className: 'dfp-title' }, t('type.label')),
                  activeResolved.length > 0
                    ? h('span', { className: 'dfp-brand-pill' }, t('header.armedBadge', { count: activeResolved.length }))
                    : null)),
              h('div', { className: 'dfp-header-actions' },
                h('button', {
                  type: 'button', className: 'dfp-icon-btn', title: t('btn.verifyAll'), 'aria-label': t('btn.verifyAll'),
                  disabled: busy, onClick: handleVerifyAll,
                }, h(ShieldIcon, { size: 14 })),
                h('button', {
                  type: 'button', className: 'dfp-icon-btn', title: t('btn.refresh'), 'aria-label': t('btn.refresh'),
                  disabled: busy, onClick: () => { void loadAll(); void loadInjection() },
                }, h(RefreshIcon, { size: 14 })))),

            /* Compact context pill: target conversation & workspace */
            h('div', { className: 'dfp-context-bar' },
              h('span', { className: 'dfp-context-label' }, t('header.sourceChat')),
              h('select', {
                className: 'dfp-context-select',
                value: effectiveSessionId,
                onChange: e => setTargetSessionId(e.target.value),
              },
                mergedSessionOptions.length === 0
                  ? h('option', { value: '' }, t('msg.noSessionOption'))
                  : mergedSessionOptions.map(s => h('option', { key: s.id, value: s.id }, s.title))),
              cwd ? h('span', { className: 'dfp-context-ws', title: cwd }, shortPathLabel(cwd)) : null),

            /* Segmented 4-Tab Switcher */
            h('div', { className: 'dfp-seg-tabs', role: 'tablist' },
              ['capsules', 'memory', 'train', 'advanced'].map(key => {
                const trainAlert = key === 'train'
                  ? (activeWatchTrainId ? 'live' : (trainings.some(x => (x.pendingQuestions || 0) > 0) ? 'ask' : ''))
                  : ''
                return h('button', {
                  key,
                  type: 'button',
                  role: 'tab',
                  'aria-selected': tab === key,
                  className: `dfp-seg-tab ${tab === key ? 'is-active' : ''}`,
                  onClick: () => {
                    setTab(key)
                    if (key === 'capsules') setCapViewMode('list')
                    if (key === 'memory') setMemViewMode('list')
                    if (key === 'train') setTrainViewMode('list')
                  },
                },
                t(`tab.${key}`),
                trainAlert ? h('span', { className: `dfp-tr-tab-dot is-${trainAlert}`, 'aria-hidden': true }) : null)
              })),
          ),

          toast ? h('div', { className: 'dfp-toast', role: 'status' }, toast) : null,

          h('div', { className: 'dfp-body' },
            /* ═══════════════ TAB 1: EXPERIENCE CAPSULES (Two-Level Clean View) ═══════════════ */
            tab === 'capsules' ? (capViewMode === 'detail' && activeCapsule
              ? (() => {
                const recap = recapByCapId.get(activeCapsule.capsuleId) || summarizeCapsuleForHuman(activeCapsule, t)
                const isMounted = activeResolved.some(r => r.capsuleId === activeCapsule.capsuleId)
                const allStages = (rawCapDetail?.capsuleId === activeCapsule.capsuleId ? rawCapDetail.workflow?.stages : null) || activeCapsule.workflow?.stages || []
                const visibleStages = showAllRaw ? allStages : allStages.slice(0, 30)
                return h('div', { className: 'dfp-stack' },
                  /* Detail Top Navigation */
                  h('div', { className: 'dfp-detail-nav' },
                    h('button', {
                      type: 'button', className: 'dfp-back-btn',
                      onClick: () => { setCapViewMode('list'); setEditingTitle(false) },
                    }, `← ${t('cap.backList')}`),
                    h('div', { className: 'dfp-btn-group' },
                      h('button', {
                        type: 'button', className: 'dfp-btn dfp-btn-soft dfp-btn-xs', disabled: busy,
                        onClick: () => { setRenameDraft(activeCapsule.title || ''); setEditingTitle(v => !v) },
                      }, t('cap.renameBtn')),
                      effectiveSessionId ? h('button', {
                        type: 'button', className: 'dfp-btn dfp-btn-soft dfp-btn-xs', disabled: busy,
                        onClick: () => handleRefreshFromSession(activeCapsule),
                      }, t('cap.refreshFromChat')) : null,
                      h('button', {
                        type: 'button', className: 'dfp-btn dfp-btn-danger-ghost dfp-btn-xs', disabled: busy,
                        onClick: () => handleDeleteCapsule(activeCapsule.capsuleId),
                      }, t('btn.delete')))),

                  /* Inline Rename Editor */
                  editingTitle ? h('div', { className: 'dfp-soft-box' },
                    h('div', { className: 'dfp-row' },
                      h('input', {
                        className: 'dfp-input',
                        placeholder: t('cap.renamePlaceholder'),
                        value: renameDraft,
                        onChange: e => setRenameDraft(e.target.value),
                      }),
                      h('button', {
                        type: 'button', className: 'dfp-btn dfp-btn-primary dfp-btn-sm', disabled: busy || !renameDraft.trim(),
                        onClick: () => handleRenameCapsule(activeCapsule.capsuleId, renameDraft),
                      }, t('cap.saveBtn')),
                      h('button', {
                        type: 'button', className: 'dfp-btn dfp-btn-soft dfp-btn-sm',
                        onClick: () => setEditingTitle(false),
                      }, t('cap.cancelBtn')))) : null,

                  /* Cognitive Recap Card ("What I Learned & Understood") */
                  h('div', { className: 'dfp-detail-card' },
                    h('div', { className: 'dfp-detail-head' },
                      h('div', { style: { minWidth: 0, flex: 1 } },
                        h('div', { className: 'dfp-cap-title-row' },
                          h('span', { className: 'dfp-detail-title' }, activeCapsule.title),
                          isMounted ? h('span', { className: 'dfp-live-tag' }, t('cap.liveBadge')) : null),
                        h('div', { className: 'dfp-detail-sub' }, recap.taskGoal),
                        h('div', { className: 'dfp-mt4' }, renderMaturityMeter(activeCapsule, t)))),

                    /* Plain Summary of What FlowPack Understood */
                    h('div', { className: 'dfp-recap-summary dfp-mt10' },
                      h('div', { className: 'dfp-recap-summary-head' },
                        h('span', null, t('cap.recapWhatILearned')),
                        h('span', { className: 'dfp-muted' }, recap.headline)),
                      recap.macroSteps.length > 0 ? h('div', { className: 'dfp-recap-steps dfp-mt6' },
                        recap.macroSteps.map((ms, idx) =>
                          h('div', { key: ms.step || idx, className: 'dfp-recap-step-row' },
                            h('span', { className: 'dfp-step-num' }, idx + 1),
                            h('div', { className: 'dfp-recap-step-text' },
                              h('strong', null, ms.label),
                              ms.summary ? h('span', { className: 'dfp-recap-step-sub' }, ` — ${ms.summary}`) : null)))) : null),

                    /* Scope Selector + Use Button */
                    h('div', { className: 'dfp-scope-box' },
                      h('div', { className: 'dfp-scope-head' },
                        h('span', { className: 'dfp-field-label' }, t('cap.scopeQuestion')),
                        h('span', { className: 'dfp-inherit-note' }, t('cap.subagentAuto'))),
                      h('div', { className: 'dfp-scope-pills' },
                        ['session', 'workspace', 'global'].map(sc => {
                          const active = isCapsuleBoundInScope(activeCapsule.capsuleId, sc)
                          return h('button', {
                            key: sc, type: 'button', disabled: busy,
                            className: `dfp-scope-pill ${active ? 'is-on' : ''}`,
                            onClick: () => handleToggleCapsuleScope(activeCapsule.capsuleId, sc),
                          }, `${active ? '✓ ' : ''}${t(`cap.scope.${sc}`)}`)
                        }))),

                    h('div', { className: 'dfp-row dfp-mt8' },
                      h('button', {
                        type: 'button', className: 'dfp-btn dfp-btn-primary dfp-btn-flex', disabled: busy,
                        onClick: () => handleSelectAndStartCapsule(activeCapsule),
                      }, h(PlayIcon, { size: 12 }), t('cap.useNowBtn')),
                      activeCapsule.maturity !== 'crystallized'
                        ? h('button', {
                          type: 'button', className: 'dfp-btn dfp-btn-soft dfp-btn-sm', disabled: busy,
                          onClick: () => handleCrystallizeCapsule(activeCapsule.capsuleId),
                        }, t('cap.makeButton'))
                        : null),

                    /* Two Clean Subtabs: Steps & History | Fixes & Share */
                    h('div', { className: 'dfp-subtabs dfp-mt10' },
                      ['route', 'selfheal'].map(sub =>
                        h('button', {
                          key: sub, type: 'button',
                          className: `dfp-subtab ${(capSubView === 'export' ? 'selfheal' : capSubView) === sub ? 'is-active' : ''}`,
                          onClick: () => setCapSubView(sub),
                        }, t(`cap.sub.${sub}`)))),

                    /* Subview A: Clean Macro Workflow + Collapsed Raw Detail + Version Genealogy */
                    (capSubView === 'route') ? h('div', { className: 'dfp-subview' },
                      h('div', { className: 'dfp-sub-heading' }, t('cap.macroTitle')),
                      recap.macroSteps.length === 0
                        ? h('div', { className: 'dfp-muted' }, t('cap.noSteps'))
                        : h('div', { className: 'dfp-timeline' },
                          recap.macroSteps.map((ms, idx) =>
                            h('div', { key: ms.step || idx, className: 'dfp-timeline-item' },
                              h('div', { className: 'dfp-timeline-rail' },
                                h('span', { className: 'dfp-timeline-num' }, idx + 1)),
                              h('div', { className: 'dfp-timeline-body' },
                                h('div', { className: 'dfp-timeline-head' },
                                  h('span', { className: 'dfp-timeline-phase' }, ms.label),
                                  ms.actionCount > 1 ? h('span', { className: 'dfp-tag-parallel' }, `${ms.actionCount}×`) : null),
                                ms.summary ? h('div', { className: 'dfp-step-desc' }, ms.summary) : null)))),

                      /* Optional Collapsed Raw Tool Calls */
                      (recap.totalRawSteps > 0 || allStages.length > 0) ? h('div', { className: 'dfp-mt10' },
                        h('button', {
                          type: 'button', className: 'dfp-link-btn',
                          onClick: () => setShowRawSteps(v => !v),
                        }, showRawSteps
                          ? `▾ ${t('cap.rawToggleHide')}`
                          : `▸ ${t('cap.rawToggleShow', { count: recap.totalRawSteps || allStages.length })}`),
                        showRawSteps ? (allStages.length === 0
                          ? h('div', { className: 'dfp-muted dfp-mt6' }, t('cap.loadingDetail'))
                          : h('div', { className: 'dfp-raw-wrap dfp-mt6' },
                            visibleStages.map((st, idx) =>
                              h('div', { key: st.stageId || idx, className: 'dfp-raw-row' },
                                h('span', { className: 'dfp-raw-idx' }, `${idx + 1}.`),
                                h('span', { className: 'dfp-raw-phase' }, st.phaseLabel || t('cap.defaultStep', { n: idx + 1 })),
                                h('span', { className: 'dfp-raw-tools' },
                                  (st.steps || []).slice(0, 3).map(s => s.goal ? `${s.tool}: ${s.goal}` : s.tool).join(' · ')))),
                            !showAllRaw && allStages.length > 30 ? h('div', { className: 'dfp-row dfp-mt6' },
                              h('span', { className: 'dfp-muted' }, t('cap.rawMoreNotice', { shown: 30, total: allStages.length })),
                              h('button', {
                                type: 'button', className: 'dfp-link-btn',
                                onClick: () => setShowAllRaw(true),
                              }, t('cap.rawShowAllBtn'))) : null)) : null) : null,

                      /* Non-Forgetting Version History */
                      h('div', { className: 'dfp-sub-heading dfp-mt12' },
                        h(HistoryIcon, { size: 13 }),
                        t('cap.historyTitle')),
                      h('div', { className: 'dfp-gen-list' },
                        (activeCapsule.workflow?.genealogySummary || []).map((g, gIdx, arr) => {
                          const isLatest = gIdx === arr.length - 1
                          return h('div', { key: g.gen, className: `dfp-gen-card ${isLatest ? 'is-current' : ''}` },
                            h('div', { className: 'dfp-gen-top' },
                              h('span', { className: 'dfp-gen-title' },
                                g.gen === 1 ? t('cap.genFirst', { gen: g.gen }) : t('cap.genLabel', { gen: g.gen }),
                                h('span', { className: 'dfp-gen-badge' }, isLatest ? t('cap.genCurrent') : actionLabel(g.action, t))),
                              !isLatest ? h('button', {
                                type: 'button', className: 'dfp-btn dfp-btn-soft dfp-btn-xs', disabled: busy,
                                onClick: () => handleRestoreGeneration(activeCapsule.capsuleId, g.gen),
                              }, t('cap.restoreGenBtn')) : null),
                            h('div', { className: 'dfp-gen-meta' }, t('cap.genStats', { steps: g.steps, guardrails: g.guardrails })),
                            g.reason ? h('div', { className: 'dfp-gen-reason' }, g.reason) : null)
                        })),
                    ) : h('div', { className: 'dfp-subview' },
                      /* Subview B: Problem-Solution Cards + Plugin Synergy + Compact Export */
                      h('div', { className: 'dfp-sub-head-row' },
                        h('div', { className: 'dfp-sub-heading' }, t('cap.healListTitle')),
                        h('button', {
                          type: 'button', className: 'dfp-link-btn',
                          onClick: () => setShowFixForm(v => !v),
                        }, showFixForm ? t('btn.collapse') : t('cap.addFixTrigger'))),

                      showFixForm ? h('div', { className: 'dfp-soft-box dfp-mb8' },
                        h('div', { className: 'dfp-row' },
                          h('input', {
                            className: 'dfp-input dfp-input-sm', placeholder: t('cap.fixToolPlaceholder'),
                            value: fixTool, onChange: e => setFixTool(e.target.value),
                          }),
                          h('input', {
                            className: 'dfp-input', placeholder: t('cap.fixSymptomPlaceholder'),
                            value: fixSymptom, onChange: e => setFixSymptom(e.target.value),
                          })),
                        h('div', { className: 'dfp-row dfp-mt6' },
                          h('input', {
                            className: 'dfp-input', placeholder: t('cap.fixResolutionPlaceholder'),
                            value: fixResolution, onChange: e => setFixResolution(e.target.value),
                          }),
                          h('button', {
                            type: 'button', className: 'dfp-btn dfp-btn-primary',
                            disabled: busy || !fixSymptom.trim() || !fixResolution.trim(),
                            onClick: () => handleRecordProblemFix(activeCapsule.capsuleId),
                          }, t('cap.addFixBtn')))) : null,

                      (activeCapsule.selfHealing?.rules || []).length === 0
                        ? h('div', { className: 'dfp-muted-box' }, t('cap.noRules'))
                        : h('div', { className: 'dfp-heal-list' },
                          (activeCapsule.selfHealing?.rules || []).map(r =>
                            h('div', { key: r.ruleId, className: 'dfp-heal-card' },
                              h('div', { className: 'dfp-heal-problem' },
                                h('span', { className: 'dfp-heal-tag is-err' }, t('cap.whenErr')),
                                h('span', { className: 'dfp-tool-tag' }, r.tool),
                                h('span', null, r.symptomPattern)),
                              h('div', { className: 'dfp-heal-fix' },
                                h('span', { className: 'dfp-heal-tag is-fix' }, t('cap.autoFix')),
                                h('span', null, r.fixSteps)),
                              h('div', { className: 'dfp-heal-fallback' }, t('cap.fallbackHint', { gen: r.fallbackGen }))))),

                      capabilities?.groups?.length > 0 ? h('div', { className: 'dfp-soft-box dfp-mt10' },
                        h('div', { className: 'dfp-sub-heading' }, t('cap.pluginsTitle', { count: capabilities.totalTools })),
                        h('div', { className: 'dfp-plugin-pills' },
                          capabilities.groups.map(g =>
                            h('span', { key: g.id, className: 'dfp-plugin-pill' },
                              h('span', { className: 'dfp-plugin-dot' }),
                              `${pluginGroupName(g.id, t)} (${g.tools.length})`)))) : null,

                      healEvents.length > 0 ? h('div', { className: 'dfp-soft-box dfp-mt8' },
                        h('div', { className: 'dfp-sub-heading' }, t('cap.recentHealEvents')),
                        healEvents.slice(0, 4).map(ev =>
                          h('div', { key: ev.id, className: 'dfp-heal-log' }, `${ev.summary || ev.kind} · ${formatTime(ev.at)}`))) : null,

                      h('div', { className: 'dfp-soft-box dfp-mt10' },
                        h('div', { className: 'dfp-row dfp-between' },
                          h('span', { className: 'dfp-sub-heading' }, t('cap.exportSectionTitle')),
                          h('button', {
                            type: 'button', className: 'dfp-link-btn',
                            onClick: () => setShowExportBox(v => !v),
                          }, showExportBox ? `▾ ${t('cap.exportToggleHide')}` : `▸ ${t('cap.exportToggleShow')}`)),
                        showExportBox ? h('div', { className: 'dfp-mt8' },
                          h('div', { className: 'dfp-format-grid' },
                            ['dshcapsule', 'skill', 'agentsMd', 'ptc', 'markdown'].map(fmt =>
                              h('button', {
                                key: fmt, type: 'button',
                                className: `dfp-format-btn ${capExportFmt === fmt ? 'is-active' : ''}`,
                                onClick: () => setCapExportFmt(fmt),
                              }, t(`export.fmt.${fmt}`)))),
                          h('pre', { className: 'dfp-pre dfp-mt8' }, exportPreview || t('cap.loadingDetail')),
                          h('div', { className: 'dfp-row dfp-mt8' },
                            h('button', {
                              type: 'button', className: 'dfp-btn dfp-btn-primary dfp-btn-sm',
                              disabled: !exportPreview,
                              onClick: () => sendToComposer(exportPreview || JSON.stringify(rawCapDetail || activeCapsule, null, 2)),
                            }, t('btn.sendComposer')),
                            h('button', {
                              type: 'button', className: 'dfp-btn dfp-btn-soft dfp-btn-sm',
                              disabled: !exportPreview,
                              onClick: async () => {
                                await copyText(exportPreview || JSON.stringify(rawCapDetail || activeCapsule, null, 2))
                                notify(t('msg.copied'))
                              },
                            }, t('btn.copy')))) : null),
                    ),
                  ),
                )
              })()
              : /* ── LEVEL 1: CAPSULES OVERVIEW ── */
              h('div', { className: 'dfp-stack' },
                /* Compact Capture Strip */
                h('div', { className: 'dfp-capture-strip' },
                  h('div', { className: 'dfp-hero-card-head' },
                    h('span', { className: 'dfp-card-eyebrow' }, h(SparkIcon, { size: 13 }), t('cap.captureTitle')),
                    h('div', { className: 'dfp-row' },
                      h('button', {
                        type: 'button', className: 'dfp-link-btn',
                        onClick: () => setShowNameInput(v => !v),
                      }, showNameInput ? t('cap.hideCustomName') : t('cap.toggleCustomName')),
                      h('button', {
                        type: 'button', className: 'dfp-link-btn',
                        onClick: () => capsuleUi.openPicker({ sessionId: effectiveSessionId, cwd, inputActions }),
                      }, t('cap.openPicker')))),
                  showNameInput ? h('div', { className: 'dfp-mt6' },
                    h('input', {
                      className: 'dfp-input',
                      placeholder: t('cap.titlePlaceholder'),
                      value: capTitleInput,
                      onChange: e => setCapTitleInput(e.target.value),
                    })) : null,
                  h('div', { className: 'dfp-row dfp-mt8' },
                    h('button', {
                      type: 'button', className: 'dfp-btn dfp-btn-primary dfp-btn-flex', disabled: busy,
                      onClick: () => handleLearnCapsule(true),
                    }, h(SparkIcon, { size: 13 }), t('cap.crystallizeBtn')),
                    h('button', {
                      type: 'button', className: 'dfp-btn dfp-btn-soft', disabled: busy,
                      onClick: () => handleLearnCapsule(false),
                    }, t('cap.learnBtn'))),
                ),

                /* "What I Just Learned" Cognitive Receipt Card */
                justLearnedCap ? (() => {
                  const jCap = capsules.find(x => x.capsuleId === justLearnedCap.capsuleId) || justLearnedCap
                  const recap = recapByCapId.get(jCap.capsuleId) || summarizeCapsuleForHuman(jCap, t)
                  return h('div', { className: 'dfp-recap-card' },
                    h('div', { className: 'dfp-recap-head' },
                      h('span', { className: 'dfp-recap-badge' }, t('cap.recapBadge')),
                      h('div', { className: 'dfp-btn-group' },
                        h('button', {
                          type: 'button', className: 'dfp-link-btn',
                          onClick: () => {
                            setSelectedCapsuleId(jCap.capsuleId)
                            setRenameDraft(jCap.title || '')
                            setEditingTitle(true)
                            setCapViewMode('detail')
                          },
                        }, t('cap.renameBtn')),
                        h('button', {
                          type: 'button', className: 'dfp-link-btn',
                          onClick: () => { setSelectedCapsuleId(jCap.capsuleId); setCapViewMode('detail') },
                        }, t('cap.recapViewDetail')),
                        h('button', {
                          type: 'button', className: 'dfp-link-btn',
                          onClick: () => setJustLearnedCap(null),
                        }, t('btn.collapse')))),
                    h('div', { className: 'dfp-recap-name dfp-mt4' }, `«${jCap.title}»`),
                    h('div', { className: 'dfp-recap-kv dfp-mt6' },
                      h('span', { className: 'dfp-recap-k' }, t('cap.recapGoalLabel')),
                      h('span', null, recap.taskGoal)),
                    recap.macroSteps.length > 0 ? h('div', { className: 'dfp-recap-steps dfp-mt6' },
                      recap.macroSteps.slice(0, 5).map((ms, idx) =>
                        h('div', { key: ms.step || idx, className: 'dfp-recap-step-row' },
                          h('span', { className: 'dfp-step-num' }, idx + 1),
                          h('span', { className: 'dfp-recap-step-text' },
                            h('strong', null, ms.label),
                            ms.summary ? ` — ${ms.summary}` : '')))) : null,
                    h('div', { className: 'dfp-recap-kv dfp-mt6' },
                      h('span', { className: 'dfp-recap-k' }, t('cap.recapFixesLabel')),
                      h('span', { className: 'dfp-muted' }, recap.keyFixes.length > 0
                        ? recap.keyFixes.slice(0, 2).map(f => f.problem ? `${f.problem} -> ${f.fix}` : f.fix).join('；')
                        : t('cap.recapNoFixesYet'))),
                    h('div', { className: 'dfp-row dfp-mt8' },
                      h('button', {
                        type: 'button', className: 'dfp-btn dfp-btn-primary dfp-btn-sm dfp-btn-flex', disabled: busy,
                        onClick: () => handleSelectAndStartCapsule(jCap),
                      }, h(PlayIcon, { size: 11 }), t('cap.useQuickBtn'))),
                  )
                })() : null,

                /* Crisp List of Experience Capsules */
                capsules.length === 0
                  ? h('div', { className: 'dfp-empty-card' },
                    h('div', { className: 'dfp-empty-icon' }, h(SparkIcon, { size: 22 })),
                    h('div', { className: 'dfp-empty-heading' }, t('cap.emptyTitle')),
                    h('p', { className: 'dfp-empty-desc' }, t('cap.empty')),
                    h('div', { className: 'dfp-onboard-steps' },
                      [1, 2, 3].map(n =>
                        h('div', { key: n, className: 'dfp-onboard-step' },
                          h('span', { className: 'dfp-step-num' }, n),
                          h('span', null, t(`cap.step${n}`))))))
                  : h('div', { className: 'dfp-list' },
                    h('div', { className: 'dfp-section-label' }, t('cap.libraryTitle', { count: capsules.length })),
                    capsules.map(c => {
                      const recap = recapByCapId.get(c.capsuleId) || summarizeCapsuleForHuman(c, t)
                      const isMounted = activeResolved.some(r => r.capsuleId === c.capsuleId)
                      const genCount = c.workflow?.genealogySummary?.length || 1
                      const targetToggleScope = c.workspaceRoot ? 'workspace' : 'global'
                      return h('div', {
                        key: c.capsuleId,
                        className: `dfp-cap-card ${isMounted ? 'is-mounted' : ''}`,
                        onClick: () => { setSelectedCapsuleId(c.capsuleId); setCapViewMode('detail') },
                      },
                        h('div', { className: 'dfp-cap-top' },
                          h('div', { className: 'dfp-cap-info' },
                            h('div', { className: 'dfp-cap-title-row' },
                              h('span', { className: 'dfp-cap-title' }, c.title),
                              h('button', {
                                type: 'button',
                                className: `dfp-cap-toggle ${isMounted ? 'is-on' : ''}`,
                                onClick: (e) => { e.stopPropagation(); void handleToggleCapsuleScope(c.capsuleId, targetToggleScope) },
                              }, isMounted ? `✓ ${t('cap.armedPill')}` : t('cap.armPill')))),
                          h('button', {
                            type: 'button',
                            className: `dfp-btn ${isMounted ? 'dfp-btn-soft' : 'dfp-btn-primary'} dfp-btn-xs`,
                            disabled: busy,
                            onClick: (e) => { e.stopPropagation(); void handleSelectAndStartCapsule(c) },
                          }, h(PlayIcon, { size: 11 }), t('cap.useQuickBtn'))),
                        h('div', { className: 'dfp-cap-headline' }, recap.taskGoal),
                        h('div', { className: 'dfp-cap-footer-row' },
                          renderMaturityMeter(c, t),
                          h('div', { className: 'dfp-cap-stats' },
                            h('span', null, t('sum.stepCountShort', { count: recap.macroSteps.length || 1 })),
                            h('span', { className: 'dfp-dot-sep' }, '·'),
                            h('span', null, t('cap.statFixes', { count: recap.fixCount })),
                            h('span', { className: 'dfp-dot-sep' }, '·'),
                            h('span', null, t('cap.statGens', { count: genCount })),
                            h('span', { className: 'dfp-dot-sep' }, '›'))),
                      )
                    }),
                  ),
              )) : null,

            /* ═══════════════ TAB 2: MEMORY NOTES (Two-Level Clean View) ═══════════════ */
            tab === 'memory' ? (memViewMode === 'detail' && activePack
              ? (() => {
                const memSum = packSummaryById.get(activePack.packId) || summarizePackForHuman(activePack, t)
                return h('div', { className: 'dfp-stack' },
                  h('div', { className: 'dfp-detail-nav' },
                    h('button', {
                      type: 'button', className: 'dfp-back-btn',
                      onClick: () => setMemViewMode('list'),
                    }, `← ${t('mem.backList')}`),
                    h('div', { className: 'dfp-btn-group' },
                      activePack.sealState !== 'sealed'
                        ? h('button', {
                          type: 'button', className: 'dfp-btn dfp-btn-primary dfp-btn-xs', disabled: busy,
                          onClick: () => handleSealPack(activePack.packId),
                        }, t('mem.sealBtn'))
                        : null,
                      h('button', {
                        type: 'button', className: 'dfp-btn dfp-btn-soft dfp-btn-xs',
                        onClick: () => sendToComposer(packDetail?.markdown || JSON.stringify(activePack, null, 2)),
                      }, t('btn.sendComposer')),
                      h('button', {
                        type: 'button', className: 'dfp-btn dfp-btn-danger-ghost dfp-btn-xs', disabled: busy,
                        onClick: () => handleDeletePack(activePack.packId),
                      }, t('btn.delete')))),
                  h('div', { className: 'dfp-detail-card' },
                    h('div', { className: 'dfp-detail-head' },
                      h('div', null,
                        h('div', { className: 'dfp-detail-title' }, activePack.title),
                        h('div', { className: 'dfp-detail-sub' }, activePack.workspaceRoot ? `${t('mem.workspaceLabel')}: ${shortPathLabel(activePack.workspaceRoot)}` : t('mem.globalLabel')))),
                    h('div', { className: 'dfp-soft-box dfp-mt8' },
                      h('div', { className: 'dfp-muted' }, memSum.headline || t('mem.sumEmpty'))),
                    ['constraints', 'facts', 'decisions', 'pitfalls', 'workflows', 'checkpoints'].map(sec => {
                      const list = activePack.entries?.[sec] || []
                      if (list.length === 0) return null
                      return h('div', { key: sec, className: 'dfp-note-group' },
                        h('div', { className: 'dfp-note-group-head' }, `${t(`sec.${sec}`)} (${list.length})`),
                        h('div', { className: 'dfp-note-hint' }, t(`secHint.${sec}`)),
                        list.map(item => h('div', { key: item.id, className: 'dfp-note-row' },
                          h('span', { className: `dfp-prio-dot is-${item.priority}`, title: t(`prio.${item.priority}`) }),
                          h('span', { className: 'dfp-note-text' }, item.text))))
                    }),
                    packDetail?.archives?.length > 1 ? h('div', { className: 'dfp-mt10' },
                      h('div', { className: 'dfp-sub-heading' }, t('mem.archives')),
                      h('div', { className: 'dfp-chip-wrap dfp-mt6' },
                        packDetail.archives.slice(0, 5).map(arc =>
                          h('button', {
                            key: arc.version,
                            type: 'button',
                            className: `dfp-btn dfp-btn-xs ${arc.version === activePack.version ? 'dfp-btn-primary' : 'dfp-btn-soft'}`,
                            disabled: busy || arc.version === activePack.version,
                            onClick: () => handleRollbackPack(activePack.packId, arc.version),
                          }, `v${arc.version}`)))) : null,
                  ),
                )
              })()
              : h('div', { className: 'dfp-stack' },
                /* Plain-language Memory Guide Card */
                h('div', { className: 'dfp-mem-explainer' },
                  h('div', { className: 'dfp-hero-card-head' },
                    h('span', { className: 'dfp-card-eyebrow' }, h(ShieldIcon, { size: 13 }), t('mem.guideTitle')),
                    h('button', {
                      type: 'button', className: 'dfp-link-btn',
                      onClick: () => setShowMemGuide(v => !v),
                    }, showMemGuide ? t('mem.guideHide') : t('mem.guideShow'))),
                  showMemGuide ? h('div', { className: 'dfp-mem-bullets dfp-mt6' },
                    h('div', null, `• ${t('mem.guideLine1')}`),
                    h('div', null, `• ${t('mem.guideLine2')}`),
                    h('div', null, `• ${t('mem.guideLine3')}`)) : null),

                h('div', { className: 'dfp-capture-strip' },
                  h('div', { className: 'dfp-hero-card-head' },
                    h('span', { className: 'dfp-card-eyebrow' }, h(ShieldIcon, { size: 13 }), t('mem.noteTitle')),
                    h('button', {
                      type: 'button', className: 'dfp-link-btn', disabled: busy,
                      onClick: handlePackSession,
                    }, t('mem.packSessionBtn'))),
                  h('div', { className: 'dfp-row dfp-mt8' },
                    h('select', { className: 'dfp-select-sm', value: pinSection, onChange: e => setPinSection(e.target.value) },
                      ['constraints', 'facts', 'decisions', 'pitfalls', 'workflows', 'checkpoints'].map(sec =>
                        h('option', { key: sec, value: sec }, t(`sec.${sec}`)))),
                    h('select', { className: 'dfp-select-sm', value: pinPriority, onChange: e => setPinPriority(e.target.value) },
                      ['critical', 'high', 'normal'].map(p => h('option', { key: p, value: p }, t(`prio.${p}`)))),
                    h('select', { className: 'dfp-select-sm', value: pinScope, onChange: e => setPinScope(e.target.value) },
                      ['workspace', 'session', 'global'].map(sc => h('option', { key: sc, value: sc }, t(`cap.scopeShort.${sc}`))))),
                  h('div', { className: 'dfp-row dfp-mt6' },
                    h('input', {
                      className: 'dfp-input',
                      placeholder: t('mem.pinPlaceholder'),
                      value: pinText,
                      onChange: e => setPinText(e.target.value),
                    }),
                    h('button', {
                      type: 'button', className: 'dfp-btn dfp-btn-primary', disabled: busy || !pinText.trim(),
                      onClick: handlePinEntry,
                    }, t('mem.pinBtn'))),
                ),

                /* "What I Just Remembered" Memory Receipt Card */
                justSavedPack?.pack ? (() => {
                  const jPack = packs.find(x => x.packId === justSavedPack.pack.packId) || justSavedPack.pack
                  const jSum = justSavedPack.memorySummary || packSummaryById.get(jPack.packId) || summarizePackForHuman(jPack, t)
                  return h('div', { className: 'dfp-recap-card' },
                    h('div', { className: 'dfp-recap-head' },
                      h('span', { className: 'dfp-recap-badge' }, t('mem.recapBadge')),
                      h('div', { className: 'dfp-btn-group' },
                        h('button', {
                          type: 'button', className: 'dfp-link-btn',
                          onClick: () => { setSelectedPackId(jPack.packId); setMemViewMode('detail') },
                        }, t('mem.viewDetail')),
                        h('button', {
                          type: 'button', className: 'dfp-link-btn',
                          onClick: () => setJustSavedPack(null),
                        }, t('btn.collapse')))),
                    h('div', { className: 'dfp-recap-name dfp-mt4' }, `«${jPack.title}»`),
                    h('div', { className: 'dfp-muted dfp-mt4' }, jSum.headline || t('mem.sumEmpty')),
                    jSum.highlights?.length > 0 ? h('div', { className: 'dfp-cap-preview-list dfp-mt6' },
                      jSum.highlights.slice(0, 4).map((hl, idx) =>
                        h('div', { key: idx, className: 'dfp-cap-preview-item' },
                          `• [${hl.sectionName || t(`sec.${hl.section}`)}] ${hl.text}`))) : null,
                  )
                })() : null,

                quarantined.length > 0 ? h('div', { className: 'dfp-alert' },
                  h('strong', null, t('mem.quarantineTitle', { count: quarantined.length })),
                  h('div', { className: 'dfp-muted dfp-mt4' }, quarantined.map(q => `${q.pack?.title || q.file}: ${q.reason}`).join(' | ')),
                ) : null,

                packs.length === 0
                  ? h('div', { className: 'dfp-empty-card' },
                    h('div', { className: 'dfp-empty-icon' }, h(ShieldIcon, { size: 22 })),
                    h('div', { className: 'dfp-empty-heading' }, t('mem.emptyTitle')),
                    h('p', { className: 'dfp-empty-desc' }, t('mem.empty')))
                  : h('div', { className: 'dfp-list' },
                    h('div', { className: 'dfp-section-label' }, t('mem.listCount', { count: packs.length })),
                    packs.map(p => {
                      const isSealed = p.sealState === 'sealed'
                      const memSum = packSummaryById.get(p.packId) || summarizePackForHuman(p, t)
                      return h('div', {
                        key: p.packId,
                        className: 'dfp-cap-card',
                        onClick: () => { setSelectedPackId(p.packId); setMemViewMode('detail') },
                      },
                        h('div', { className: 'dfp-cap-top' },
                          h('div', { className: 'dfp-cap-info' },
                            h('span', { className: 'dfp-cap-title' }, p.title),
                            h('div', { className: 'dfp-cap-stats dfp-mt4' },
                              h('span', null, t('mem.entryCount', { count: memSum.totalEntries })),
                              h('span', { className: 'dfp-dot-sep' }, '·'),
                              h('span', null, t(`cap.scopeShort.${p.scope === 'workflow' ? 'workspace' : p.scope}`)),
                              h('span', { className: 'dfp-dot-sep' }, '·'),
                              h('span', null, `v${p.version}`))),
                          h('span', {
                            className: `dfp-seal-badge ${isSealed ? 'is-ok' : 'is-warn'}`,
                            title: p.integrity?.sha256 ? `SHA-256: ${p.integrity.sha256}` : '',
                          }, isSealed ? h(ShieldIcon, { size: 11 }) : null, isSealed ? t('mem.sealedTag') : t('mem.draftTag'))),
                        h('div', { className: 'dfp-cap-subtitle dfp-mt6' }, memSum.headline || t('mem.sumEmpty')),
                        memSum.highlights?.length > 0 ? h('div', { className: 'dfp-cap-preview-list dfp-mt6' },
                          memSum.highlights.slice(0, 2).map((hl, idx) =>
                            h('div', { key: idx, className: 'dfp-cap-preview-item' },
                              `• [${hl.sectionName || t(`sec.${hl.section}`)}] ${hl.text}`))) : null,
                      )
                    })),
              )) : null,

            /* ═══════════════ TAB 2.5: WATCH & TRAIN (HUMAN -> AI APPRENTICESHIP) ═══════════════ */
            tab === 'train' ? (() => {
              const d = trainDetail || activeTraining
              const demoSteps = Array.isArray(d?.demoSteps) ? d.demoSteps : []
              const questions = Array.isArray(d?.questions) ? d.questions : []
              const pendingQs = questions.filter(q => q.status === 'pending')
              const settledQs = questions.filter(q => q.status !== 'pending')
              const rounds = Array.isArray(d?.rounds) ? d.rounds : []
              const liveWatchingItem = trainings.find(x => x.status === 'watching' || x.trainId === activeWatchTrainId)

              if (trainViewMode === 'list') {
                return h('div', { className: 'dfp-stack' },
                  liveWatchingItem
                    ? h('div', { className: 'dfp-tr-watch-bar' },
                      h('div', { className: 'dfp-tr-watch-info' },
                        h('span', { className: 'dfp-tr-pulse' }),
                        h('span', null, `${t('train.activeWatchBanner')}：${liveWatchingItem.title}`)),
                      h('button', {
                        type: 'button',
                        className: 'dfp-tr-btn is-primary',
                        onClick: () => {
                          setSelectedTrainId(liveWatchingItem.trainId)
                          setTrainViewMode('detail')
                        },
                      }, t('train.enterWatchBtn')))
                    : null,

                  h('div', { className: 'dfp-tr-hero' },
                    h('div', { className: 'dfp-tr-hero-title' }, t('train.heroTitle')),
                    h('div', { className: 'dfp-tr-hero-desc' }, t('train.heroDesc')),
                    !watchSupported
                      ? h('div', { className: 'dfp-tr-warn-box' }, t('train.unsupportedHint'))
                      : null,
                    h('input', {
                      className: 'dfp-tr-input',
                      value: trainTitleInput,
                      placeholder: t('train.titlePh'),
                      onChange: e => setTrainTitleInput(e.target.value),
                    }),
                    h('textarea', {
                      className: 'dfp-tr-textarea',
                      rows: 2,
                      value: trainGoalInput,
                      placeholder: t('train.goalPh'),
                      onChange: e => setTrainGoalInput(e.target.value),
                    }),
                    h('label', { className: 'dfp-tr-check' },
                      h('input', {
                        type: 'checkbox',
                        checked: trainAutoQuestion,
                        onChange: e => setTrainAutoQuestion(e.target.checked),
                      }),
                      h('span', null, t('train.autoQToggle'))),
                    h('div', { className: 'dfp-tr-actions' },
                      h('button', {
                        type: 'button',
                        className: 'dfp-tr-btn is-primary',
                        disabled: busy,
                        onClick: () => handleStartWatch(false),
                      }, `🔴 ${t('train.startWatchBtn')}`),
                      h('button', {
                        type: 'button',
                        className: 'dfp-tr-btn',
                        disabled: busy,
                        onClick: () => handleStartWatch(true),
                      }, `+ ${t('train.newManualBtn')}`))),

                  h('div', { className: 'dfp-section-label' }, t('train.listTitle')),
                  trainings.length === 0
                    ? h('div', { className: 'dfp-tr-empty' }, t('train.empty'))
                    : h('div', { className: 'dfp-list' },
                      trainings.map(item =>
                        h('div', {
                          key: item.trainId,
                          className: 'dfp-tr-card is-clickable',
                          onClick: () => {
                            setSelectedTrainId(item.trainId)
                            setTrainDetail(null)
                            setEditingTrainTitle(false)
                            setExpandedFrameSeq(null)
                            setJustGraduated(null)
                            setTrainViewMode('detail')
                          },
                        },
                        h('div', { className: 'dfp-tr-card-head' },
                          h('span', { className: 'dfp-tr-card-title' }, item.title || item.trainId),
                          h('span', { className: `dfp-tr-badge is-${item.status || 'ready_for_training'}` },
                            trainStatusLabel(item.status, t)),
                          h('button', {
                            type: 'button',
                            className: 'dfp-tr-del-mini',
                            title: t('train.deleteBtn'),
                            disabled: busy,
                            onClick: (e) => {
                              e.stopPropagation()
                              void handleDeleteTraining(item.trainId)
                            },
                          }, '×')),
                        h('div', { className: 'dfp-tr-meta-row' },
                          h('span', { className: 'dfp-tr-pill' }, t('train.stepCount', { count: item.stepCount || 0 })),
                          h('span', { className: 'dfp-tr-pill' }, t('train.roundCount', { count: item.roundCount || 0 })),
                          (item.pendingQuestions || 0) > 0
                            ? h('span', { className: 'dfp-tr-pill is-warn' }, `❓ ${t('train.pendingQBadge', { count: item.pendingQuestions })}`)
                            : null,
                          (item.betterMethodCount || 0) > 0 || item.betterMethodProposal
                            ? h('span', { className: 'dfp-tr-pill is-ok' }, `✨ ${t('train.betterFoundBadge')}`)
                            : null),
                        item.aiLiveSummary || item.goal
                          ? h('div', { className: 'dfp-tr-muted dfp-tr-clamp' }, item.aiLiveSummary || item.goal)
                          : null))),
                )
              }

              /* Level 2: Detail Training Workspace */
              if (!d) {
                return h('div', { className: 'dfp-stack' },
                  h('div', { className: 'dfp-tr-nav' },
                    h('button', {
                      type: 'button',
                      className: 'dfp-tr-back',
                      onClick: () => setTrainViewMode('list'),
                    }, `← ${t('train.backToList')}`)),
                  h('div', { className: 'dfp-tr-empty' }, t('train.empty')))
              }

              const betterText = typeof d.betterMethodProposal === 'string'
                ? d.betterMethodProposal
                : [d.betterMethodProposal?.method, d.betterMethodProposal?.benefit, d.betterMethodProposal?.reason]
                  .filter(Boolean).join(' — ')
              const gradCapId = justGraduated?.capsule?.capsuleId || d.resultCapsuleId
              const gradPackId = justGraduated?.pack?.packId || d.resultPackId

              return h('div', { className: 'dfp-stack' },
                /* Nav bar */
                h('div', { className: 'dfp-tr-nav' },
                  h('button', {
                    type: 'button',
                    className: 'dfp-tr-back',
                    onClick: () => setTrainViewMode('list'),
                  }, `← ${t('train.backToList')}`),
                  h('div', { className: 'dfp-tr-nav-actions' },
                    h('button', {
                      type: 'button',
                      className: 'dfp-tr-btn-sm',
                      disabled: busy,
                      onClick: () => {
                        setTrainRenameDraft(d.title || '')
                        setEditingTrainTitle(v => !v)
                      },
                    }, `✎ ${t('train.renameBtn')}`),
                    h('button', {
                      type: 'button',
                      className: 'dfp-tr-btn-sm is-danger',
                      disabled: busy,
                      onClick: () => handleDeleteTraining(d.trainId),
                    }, t('train.deleteBtn')))),

                /* Header & Live Watch Bar */
                h('div', { className: 'dfp-tr-card' },
                  editingTrainTitle
                    ? h('div', { className: 'dfp-tr-inline-row' },
                      h('input', {
                        className: 'dfp-tr-input',
                        value: trainRenameDraft,
                        onChange: e => setTrainRenameDraft(e.target.value),
                      }),
                      h('button', {
                        type: 'button',
                        className: 'dfp-tr-btn-sm is-primary',
                        disabled: busy,
                        onClick: handleRenameTrain,
                      }, t('train.saveNameBtn')),
                      h('button', {
                        type: 'button',
                        className: 'dfp-tr-btn-sm',
                        onClick: () => setEditingTrainTitle(false),
                      }, t('train.cancelBtn')))
                    : h('div', { className: 'dfp-tr-card-head' },
                      h('span', { className: 'dfp-tr-card-title' }, d.title || d.trainId),
                      h('span', { className: `dfp-tr-badge is-${d.status || 'ready_for_training'}` },
                        trainStatusLabel(d.status, t))),
                  d.goal ? h('div', { className: 'dfp-tr-muted', style: { marginTop: '4px' } }, d.goal) : null,

                  d.status === 'watching'
                    ? h('div', { className: 'dfp-tr-watch-bar', style: { marginTop: '8px' } },
                      h('div', { className: 'dfp-tr-watch-info' },
                        h('span', { className: 'dfp-tr-pulse' }),
                        h('span', null, t('train.watchingStatus', { count: demoSteps.length }))),
                      h('div', { className: 'dfp-tr-actions' },
                        h('button', {
                          type: 'button',
                          className: 'dfp-tr-btn-sm',
                          disabled: busy,
                          onClick: handleCaptureNow,
                        }, `📸 ${t('train.captureNowBtn')}`),
                        h('button', {
                          type: 'button',
                          className: 'dfp-tr-btn-sm',
                          disabled: busy,
                          onClick: handleAiReview,
                        }, `❓ ${t('train.aiAskBtn')}`),
                        h('button', {
                          type: 'button',
                          className: 'dfp-tr-btn-sm is-primary',
                          disabled: busy,
                          onClick: handleStopWatch,
                        }, `⏹ ${t('train.finishDemoBtn')}`)))
                    : (d.status !== 'graduated'
                      ? h('div', { className: 'dfp-tr-actions', style: { marginTop: '8px' } },
                        h('button', {
                          type: 'button',
                          className: 'dfp-tr-btn-sm',
                          disabled: busy,
                          onClick: () => handleResumeWatch(d.trainId),
                        }, `🔴 ${t('train.resumeWatchBtn')}`),
                        h('button', {
                          type: 'button',
                          className: 'dfp-tr-btn-sm',
                          disabled: busy,
                          onClick: handleAiReview,
                        }, `✨ ${t('train.aiReviewBtn')}`))
                      : null)),

                /* AI Live Understanding + Better Alternative Suggestion */
                h('div', { className: 'dfp-tr-card' },
                  h('div', { className: 'dfp-tr-subhead' }, `🧠 ${t('train.aiSummaryTitle')}`),
                  h('div', { className: 'dfp-tr-body-text' }, d.aiLiveSummary || t('train.aiNoSummaryYet')),
                  betterText
                    ? h('div', { className: 'dfp-tr-better' },
                      h('div', { className: 'dfp-tr-better-title' }, `✨ ${t('train.betterTitle')}`),
                      h('div', { className: 'dfp-tr-body-text' }, betterText))
                    : null),

                /* Real-time AI Questions Card */
                h('div', { className: 'dfp-tr-card' },
                  h('div', { className: 'dfp-tr-subhead' },
                    `🤖 ${t('train.questionsTitle')}`,
                    pendingQs.length > 0
                      ? h('span', { className: 'dfp-tr-pill is-warn', style: { marginLeft: '6px' } },
                        t('train.pendingQBadge', { count: pendingQs.length }))
                      : null),
                  questions.length === 0
                    ? h('div', { className: 'dfp-tr-muted' }, t('train.questionsEmpty'))
                    : h('div', { className: 'dfp-tr-q-list' },
                      pendingQs.map(q =>
                        h('div', { key: q.qId, className: 'dfp-tr-q is-pending' },
                          h('div', { className: 'dfp-tr-q-text' }, `❓ ${q.question}`),
                          q.reason ? h('div', { className: 'dfp-tr-muted' }, q.reason) : null,
                          h('input', {
                            className: 'dfp-tr-input',
                            value: questionDrafts[q.qId] || '',
                            placeholder: t('train.answerPh'),
                            onChange: e => setQuestionDrafts(prev => ({ ...prev, [q.qId]: e.target.value })),
                          }),
                          h('div', { className: 'dfp-tr-actions' },
                            h('button', {
                              type: 'button',
                              className: 'dfp-tr-btn-sm is-primary',
                              disabled: busy,
                              onClick: () => handleAnswerQuestion(q.qId, false),
                            }, t('train.answerBtn')),
                            h('button', {
                              type: 'button',
                              className: 'dfp-tr-btn-sm',
                              disabled: busy,
                              onClick: () => handleAnswerQuestion(q.qId, true),
                            }, t('train.skipQBtn'))))),
                      settledQs.map(q =>
                        h('div', { key: q.qId, className: 'dfp-tr-q is-settled' },
                          h('div', { className: 'dfp-tr-q-text' }, `• ${q.question}`),
                          h('div', { className: 'dfp-tr-muted' },
                            q.status === 'skipped'
                              ? t('train.skippedTag')
                              : `${t('train.answeredTag')}：${q.answer || ''}`))))),

                /* Human Demonstration Timeline */
                h('div', { className: 'dfp-tr-card' },
                  h('div', { className: 'dfp-tr-subhead' }, `👁️ ${t('train.stepsTitle', { count: demoSteps.length })}`),
                  demoSteps.length === 0
                    ? h('div', { className: 'dfp-tr-muted' }, t('train.stepsEmpty'))
                    : h('div', { className: 'dfp-tr-steps' },
                      demoSteps.map(step => {
                        const rawShot = step.screenshotFile || step.screenshotPath || step.frameFile || ''
                        const frameFile = rawShot ? String(rawShot).split(/[\\/]/).pop() : ''
                        const frameUrl = frameFile
                          ? `/api/flowpack.train?frame=1&trainId=${encodeURIComponent(d.trainId)}&file=${encodeURIComponent(frameFile)}`
                          : ''
                        const isExpanded = expandedFrameSeq === step.seq
                        const savedNote = step.humanNote ?? step.note ?? ''
                        const noteVal = stepNoteDrafts[step.seq] !== undefined
                          ? stepNoteDrafts[step.seq]
                          : savedNote
                        const appLabel = step.exe || step.app || ''
                        const stepText = step.semanticSummary || step.summary || step.windowTitle || step.actionType
                        return h('div', { key: step.seq, className: 'dfp-tr-step' },
                          h('div', { className: 'dfp-tr-step-head' },
                            h('span', { className: 'dfp-tr-step-no' }, `#${step.seq}`),
                            appLabel ? h('span', { className: 'dfp-tr-pill' }, appLabel) : null,
                            h('span', { className: 'dfp-tr-step-summary' }, stepText),
                            frameUrl
                              ? h('button', {
                                type: 'button',
                                className: 'dfp-tr-link-btn',
                                onClick: () => setExpandedFrameSeq(isExpanded ? null : step.seq),
                              }, `📷 ${isExpanded ? t('train.hideFrame') : t('train.viewFrame')}`)
                              : null,
                            h('button', {
                              type: 'button',
                              className: 'dfp-tr-del-mini',
                              disabled: busy,
                              onClick: () => handleDeleteDemoStep(step.seq),
                            }, '×')),
                          isExpanded && frameUrl
                            ? h('img', { className: 'dfp-tr-frame', src: frameUrl, alt: `Step ${step.seq}` })
                            : null,
                          h('div', { className: 'dfp-tr-inline-row' },
                            h('input', {
                              className: 'dfp-tr-input is-compact',
                              value: noteVal,
                              placeholder: t('train.stepNotePh'),
                              onChange: e => setStepNoteDrafts(prev => ({ ...prev, [step.seq]: e.target.value })),
                            }),
                            stepNoteDrafts[step.seq] !== undefined && stepNoteDrafts[step.seq] !== savedNote
                              ? h('button', {
                                type: 'button',
                                className: 'dfp-tr-btn-sm',
                                disabled: busy,
                                onClick: () => handleSaveStepNote(step.seq),
                              }, t('train.saveNoteBtn'))
                              : null))
                      })),
                  h('div', { className: 'dfp-tr-inline-row', style: { marginTop: '8px' } },
                    h('input', {
                      className: 'dfp-tr-input',
                      value: manualStepInput,
                      placeholder: t('train.addStepPh'),
                      onChange: e => setManualStepInput(e.target.value),
                    }),
                    h('button', {
                      type: 'button',
                      className: 'dfp-tr-btn-sm',
                      disabled: busy || !manualStepInput.trim(),
                      onClick: handleAddManualStep,
                    }, t('train.addStepBtn')))),

                /* AI Practice Rounds & Human Coaching Card */
                h('div', { className: 'dfp-tr-card' },
                  h('div', { className: 'dfp-tr-subhead' }, `🏋️ ${t('train.roundsTitle', { count: rounds.length })}`),
                  h('div', { className: 'dfp-tr-muted', style: { marginBottom: '6px' } }, t('train.roundsHint')),
                  h('textarea', {
                    className: 'dfp-tr-textarea',
                    rows: 2,
                    value: roundFeedbackInput,
                    placeholder: t('train.coachPh'),
                    onChange: e => setRoundFeedbackInput(e.target.value),
                  }),
                  h('div', { className: 'dfp-tr-actions', style: { marginTop: '6px' } },
                    h('button', {
                      type: 'button',
                      className: 'dfp-tr-btn is-primary',
                      disabled: busy,
                      onClick: () => handleStartTrainingRound(rounds.some(r => r.verdict === 'needs_fix') ? 'fix' : 'practice'),
                    }, `🚀 ${t('train.startRoundBtn', { next: rounds.length + 1 })}`),
                    h('button', {
                      type: 'button',
                      className: 'dfp-tr-btn',
                      disabled: busy || !effectiveSessionId,
                      onClick: handleRecordRoundFromChat,
                    }, `📥 ${t('train.syncRoundBtn')}`),
                    demoSteps.length > 0 && d.status !== 'graduated'
                      ? h('button', {
                        type: 'button',
                        className: 'dfp-tr-btn is-ok',
                        disabled: busy,
                        onClick: handleGraduateTraining,
                      }, `🎓 ${t('train.graduateDirectBtn')}`)
                      : null),

                  rounds.length === 0
                    ? h('div', { className: 'dfp-tr-muted', style: { marginTop: '8px' } }, t('train.roundsEmpty'))
                    : h('div', { className: 'dfp-tr-rounds' },
                      rounds.map(r => {
                        const isBetter = (r.approach || r.methodType) === 'better_alternative'
                        const whyBetter = r.approachReason || r.betterMethodReason || ''
                        const toolsList = Array.isArray(r.toolsUsed) ? r.toolsUsed : (Array.isArray(r.tools) ? r.tools : [])
                        const delivList = Array.isArray(r.deliverables) ? r.deliverables : []
                        return h('div', { key: r.roundNo, className: `dfp-tr-round is-${r.verdict || 'pending'}` },
                          h('div', { className: 'dfp-tr-card-head' },
                            h('span', { className: 'dfp-tr-step-no' }, t('train.roundHeader', { no: r.roundNo })),
                            h('span', { className: `dfp-tr-pill ${isBetter ? 'is-ok' : ''}` },
                              isBetter ? `🚀 ${t('train.methodBetter')}` : `🖐️ ${t('train.methodDemo')}`),
                            h('span', { className: `dfp-tr-pill ${r.verdict === 'accepted' ? 'is-ok' : (r.verdict === 'needs_fix' ? 'is-warn' : '')}` },
                              roundVerdictLabel(r.verdict, t))),
                          whyBetter
                            ? h('div', { className: 'dfp-tr-better-line' }, `✨ ${whyBetter}`)
                            : null,
                          r.summary
                            ? h('div', { className: 'dfp-tr-body-text', style: { marginTop: '4px' } }, r.summary)
                            : null,
                          toolsList.length > 0
                            ? h('div', { className: 'dfp-tr-meta-row', style: { marginTop: '4px' } },
                              toolsList.slice(0, 6).map((tl, idx) => h('span', { key: idx, className: 'dfp-tr-pill' }, tl)))
                            : null,
                          delivList.length > 0
                            ? h('div', { className: 'dfp-tr-muted', style: { marginTop: '3px' } },
                              `📎 ${delivList.slice(0, 4).join(', ')}`)
                            : null,
                          r.humanNote
                            ? h('div', { className: 'dfp-tr-human-note' }, `💬 ${t('train.humanNotePrefix')}${r.humanNote}`)
                            : null,
                          d.status !== 'graduated'
                            ? h('div', { className: 'dfp-tr-actions', style: { marginTop: '7px' } },
                              h('button', {
                                type: 'button',
                                className: 'dfp-tr-btn-sm is-warn',
                                disabled: busy,
                                onClick: () => handleAnnotateRound(r.roundNo, 'needs_fix', true),
                              }, `⚠️ ${t('train.fixNextBtn')}`),
                              h('button', {
                                type: 'button',
                                className: 'dfp-tr-btn-sm',
                                disabled: busy,
                                onClick: () => handleAnnotateRound(r.roundNo, 'ok_practice_more', true),
                              }, `🔄 ${t('train.practiceMoreBtn')}`),
                              h('button', {
                                type: 'button',
                                className: 'dfp-tr-btn-sm is-ok',
                                disabled: busy,
                                onClick: () => handleAcceptAndGraduate(r.roundNo),
                              }, `✅ ${t('train.acceptAndGraduateBtn')}`))
                            : null)
                      }))),

                /* Graduated Output Receipt */
                (d.status === 'graduated' || gradCapId || gradPackId)
                  ? h('div', { className: 'dfp-tr-receipt' },
                    h('div', { className: 'dfp-tr-receipt-title' }, `🎓 ${t('train.graduatedTitle')}`),
                    h('div', { className: 'dfp-tr-body-text' }, t('train.graduatedDesc')),
                    h('div', { className: 'dfp-tr-actions', style: { marginTop: '8px' } },
                      gradCapId
                        ? h('button', {
                          type: 'button',
                          className: 'dfp-tr-btn-sm is-primary',
                          onClick: () => {
                            setSelectedCapsuleId(gradCapId)
                            setCapViewMode('detail')
                            setTab('capsules')
                          },
                        }, `⚡ ${t('train.openCapsuleBtn')}`)
                        : null,
                      gradPackId
                        ? h('button', {
                          type: 'button',
                          className: 'dfp-tr-btn-sm',
                          onClick: () => {
                            setSelectedPackId(gradPackId)
                            setMemViewMode('detail')
                            setTab('memory')
                          },
                        }, `🧠 ${t('train.openMemoryBtn')}`)
                        : null))
                  : null,
              )
            })() : null,

            /* ═══════════════ TAB 3: ADVANCED TOOLS ═══════════════ */
            tab === 'advanced' ? h('div', { className: 'dfp-stack' },
              h('div', { className: 'dfp-subtabs' },
                ['portability', 'injection', 'workflows'].map(sub =>
                  h('button', {
                    key: sub, type: 'button',
                    className: `dfp-subtab ${advSubTab === sub ? 'is-active' : ''}`,
                    onClick: () => setAdvSubTab(sub),
                  }, t(`adv.${sub}`)))),

              /* Adv 1: Portability (Import / Export) */
              advSubTab === 'portability' ? h('div', { className: 'dfp-stack' },
                h('div', { className: 'dfp-detail-card' },
                  h('div', { className: 'dfp-sub-heading' }, t('port.importTitle')),
                  h('p', { className: 'dfp-card-sub' }, t('port.importHint')),
                  h('textarea', {
                    className: 'dfp-textarea dfp-mt8',
                    placeholder: t('port.importPlaceholder'),
                    value: importJson,
                    onChange: e => setImportJson(e.target.value),
                  }),
                  h('div', { className: 'dfp-row dfp-mt8' },
                    h('button', {
                      type: 'button', className: 'dfp-btn dfp-btn-primary', disabled: busy || !importJson.trim(),
                      onClick: handleImportBundle,
                    }, t('port.importBtn'))),
                ),
                activeCapsule ? h('div', { className: 'dfp-detail-card' },
                  h('div', { className: 'dfp-detail-head' },
                    h('span', { className: 'dfp-detail-title' }, `${t('port.capsuleExportTitle')}: ${activeCapsule.title}`),
                    h('button', {
                      type: 'button', className: 'dfp-btn dfp-btn-soft dfp-btn-sm',
                      onClick: async () => {
                        let text = capExportFmt === 'dshcapsule' ? exportPreview : ''
                        if (!text) {
                          try {
                            const r = await api(`/api/flowpack.capsules?capsuleId=${encodeURIComponent(activeCapsule.capsuleId)}&format=dshcapsule`)
                            text = r.exports?.dshcapsule || ''
                          } catch {}
                        }
                        await copyText(text || JSON.stringify(rawCapDetail || activeCapsule, null, 2))
                        notify(t('msg.copied'))
                      },
                    }, t('port.copyCapsuleJson'))),
                  h('pre', { className: 'dfp-pre dfp-mt8' }, (capExportFmt === 'dshcapsule' && exportPreview) ? exportPreview : JSON.stringify(rawCapDetail || activeCapsule, null, 2)),
                ) : null,
                activePack ? h('div', { className: 'dfp-detail-card' },
                  h('div', { className: 'dfp-detail-head' },
                    h('span', { className: 'dfp-detail-title' }, `${t('port.exportTitle')}: ${activePack.title}`),
                    h('button', {
                      type: 'button', className: 'dfp-btn dfp-btn-soft dfp-btn-sm',
                      onClick: async () => {
                        await copyText(JSON.stringify(activePack, null, 2))
                        notify(t('msg.copied'))
                      },
                    }, t('port.copyJson'))),
                  h('pre', { className: 'dfp-pre dfp-mt8' }, JSON.stringify(activePack, null, 2)),
                ) : null,
              ) : null,

              /* Adv 2: Live Context Preview */
              advSubTab === 'injection' ? h('div', { className: 'dfp-stack' },
                h('div', { className: 'dfp-detail-card' },
                  h('div', { className: 'dfp-detail-head' },
                    h('span', { className: 'dfp-detail-title' }, t('inj.title')),
                    h('span', { className: 'dfp-seal-badge is-ok' }, `${injection?.budgetPct || 0}%`)),
                  h('div', { className: 'dfp-progress dfp-mt8' },
                    h('div', { className: 'dfp-progress-bar', style: { width: `${Math.min(100, injection?.budgetPct || 0)}%` } })),
                  h('div', { className: 'dfp-cap-stats dfp-mt8' },
                    h('span', null, t('inj.statChars', { used: injection?.charCount || 0, max: injection?.maxChars || 3600 })),
                    h('span', { className: 'dfp-dot-sep' }, '·'),
                    h('span', null, t('inj.statCaps', { count: injection?.includedCapsules?.length || 0 })),
                    h('span', { className: 'dfp-dot-sep' }, '·'),
                    h('span', null, t('inj.statPacks', { count: injection?.includedPacks?.length || 0 }))),
                ),
                h('pre', { className: 'dfp-pre' }, injection?.text || t('inj.empty')),
              ) : null,

              /* Adv 3: Low-level Workflows */
              advSubTab === 'workflows' ? h('div', { className: 'dfp-stack' },
                h('div', { className: 'dfp-hero-card' },
                  h('div', { className: 'dfp-row' },
                    h('input', {
                      className: 'dfp-input',
                      placeholder: t('wf.titlePlaceholder'),
                      value: customTitle,
                      onChange: e => setCustomTitle(e.target.value),
                    }),
                    h('button', {
                      type: 'button', className: 'dfp-btn dfp-btn-primary', disabled: busy,
                      onClick: handleDistill,
                    }, t('wf.distillBtn'))),
                ),
                workflows.length === 0
                  ? h('div', { className: 'dfp-muted-box' }, t('wf.empty'))
                  : h('div', { className: 'dfp-list' },
                    workflows.map(wf => {
                      const m = wf.optimized?.metrics || {}
                      const isSel = activeWorkflow?.workflowId === wf.workflowId
                      return h('div', {
                        key: wf.workflowId,
                        className: `dfp-cap-card ${isSel ? 'is-selected' : ''}`,
                        onClick: () => setSelectedWfId(wf.workflowId),
                      },
                        h('div', { className: 'dfp-cap-top' },
                          h('span', { className: 'dfp-cap-title' }, wf.title),
                          h('span', { className: `dfp-seal-badge ${wf.promotedAsSkill ? 'is-ok' : ''}` },
                            wf.promotedAsSkill ? `v${wf.version} · Skill` : `v${wf.version}`)),
                        h('div', { className: 'dfp-cap-stats dfp-mt4' },
                          `${m.beforeSteps ?? 0} → ${m.afterSteps ?? 0} 步 · 评分 ${m.afterScore ?? 0}/100`),
                      )
                    }),
                  ),
                activeWorkflow ? h('div', { className: 'dfp-detail-card' },
                  h('div', { className: 'dfp-detail-head' },
                    h('div', { className: 'dfp-detail-title' }, activeWorkflow.title),
                    h('div', { className: 'dfp-btn-group' },
                      h('button', {
                        type: 'button', className: 'dfp-btn dfp-btn-soft dfp-btn-xs', disabled: busy,
                        onClick: () => handlePromoteToggle(activeWorkflow),
                      }, activeWorkflow.promotedAsSkill ? t('wf.demoteBtn') : t('wf.promoteBtn')),
                      h('button', {
                        type: 'button', className: 'dfp-btn dfp-btn-danger-ghost dfp-btn-xs', disabled: busy,
                        onClick: () => handleDeleteWorkflow(activeWorkflow.workflowId),
                      }, t('btn.delete')))),
                  h('div', { className: 'dfp-row dfp-mt8' },
                    h('input', {
                      className: 'dfp-input',
                      placeholder: t('wf.guardrailPlaceholder'),
                      value: guardrailInput,
                      onChange: e => setGuardrailInput(e.target.value),
                    }),
                    h('button', {
                      type: 'button', className: 'dfp-btn dfp-btn-primary', disabled: busy,
                      onClick: () => handleOptimize(activeWorkflow.workflowId),
                    }, t('wf.optimizeBtn'))),
                  h('div', { className: 'dfp-subtabs dfp-mt8' },
                    ['stages', 'skill', 'script'].map(mode =>
                      h('button', {
                        key: mode, type: 'button',
                        className: `dfp-subtab ${artifactMode === mode ? 'is-active' : ''}`,
                        onClick: () => setArtifactMode(mode),
                      }, t(`wf.view.${mode}`)))),
                  artifactMode === 'stages'
                    ? h('div', { className: 'dfp-timeline dfp-mt8' },
                      (activeWorkflow.optimized?.stages || []).map((st, idx) =>
                        h('div', { key: st.stageId || idx, className: 'dfp-timeline-item' },
                          h('div', { className: 'dfp-timeline-rail' }, h('span', { className: 'dfp-timeline-num' }, idx + 1)),
                          h('div', { className: 'dfp-timeline-body' },
                            h('div', { className: 'dfp-timeline-phase' }, st.phaseLabel),
                            st.steps.map(step => h('div', { key: step.id, className: 'dfp-step-desc' },
                              h('span', { className: 'dfp-tool-tag' }, step.tool),
                              h('span', null, ` ${step.goal}`)))))))
                    : h('pre', { className: 'dfp-pre dfp-mt8' },
                      artifactMode === 'skill' ? activeWorkflow.artifacts?.skillMarkdown : activeWorkflow.artifacts?.workflowScript),
                ) : null,
              ) : null,
            ) : null,
          ),
        )
      }
    }

    function createTitle(t) {
      return function FlowPackTitle({ useTabInfo }) {
        const { tab } = useTabInfo()
        return h('span', { className: 'dfp-title-chip' },
          h(FlowGlyph, { size: 15 }),
          h('span', null, tab?.title || t('type.label')))
      }
    }

    function createHeaderEntry(ctx, t) {
      return function FlowPackHeaderEntry() {
        return h('button', {
          type: 'button',
          className: 'dfp-header-entry',
          title: t('header.open'),
          'aria-label': t('header.open'),
          onClick: () => { try { ctx.sidebarRight.openTab(KIND) } catch { /* ignore */ } },
        }, h(FlowGlyph, { size: 16 }))
      }
    }

    function createComposerEntry(ctx, t) {
      return function FlowPackComposerEntry() {
        return h('button', {
          type: 'button',
          className: 'dfp-composer-entry',
          title: t('header.open'),
          'aria-label': t('header.open'),
          onClick: () => { try { ctx.sidebarRight.openTab(KIND) } catch { /* ignore */ } },
        }, h(FlowGlyph, { size: 14 }), h('span', { className: 'dfp-composer-label' }, t('entry.label')))
      }
    }

    function createCapsuleDock(ctx, t) {
      return function FlowPackCapsuleDock(props) {
        const sessionId = props?.sessionId || ''
        const useSessions = props?.useSessions
        const inputActions = props?.inputActions
        const sessionRow = typeof useSessions === 'function' ? useSessions(s => s?.byId?.[sessionId]) : undefined
        const cwd = sessionRow?.cwd || ''
        const uiState = useCapsuleUi()
        const [data, setData] = useState({ resolved: [], capsules: [] })

        const refresh = useCallback(() => {
          fetchActivateLite(sessionId, cwd, uiState.syncVersion)
            .then(r => setData({
              resolved: Array.isArray(r.resolved) ? r.resolved : [],
              capsules: Array.isArray(r.capsules) ? r.capsules : [],
            }))
            .catch(() => {})
        }, [sessionId, cwd, uiState.syncVersion])

        useEffect(() => { refresh() }, [refresh])

        const crystallized = data.capsules.filter(c => c.maturity === 'crystallized')
        const activeCount = data.resolved.length

        const quickUse = async (cap) => {
          try {
            await api('/api/flowpack.activate', {
              method: 'POST',
              body: JSON.stringify({
                action: 'toggle',
                capsuleId: cap.capsuleId,
                scope: cap.workspaceRoot ? 'workspace' : 'global',
                sessionId,
                cwd,
                inheritSubagents: true,
              }),
            })
            capsuleUi.notifySync()
          } catch { /* ignore */ }
        }

        return h('div', { className: 'dfp-dock' },
          h('button', {
            type: 'button',
            className: `dfp-dock-trigger ${activeCount > 0 ? 'is-armed' : ''}`,
            title: t('dock.tooltip'),
            onClick: () => capsuleUi.openPicker({ sessionId, cwd, inputActions }),
          },
            h(SparkIcon, { size: 12 }),
            h('span', null, activeCount > 0 ? t('dock.activeLabel', { count: activeCount }) : t('dock.pickLabel'))),
          data.resolved.slice(0, 3).map(r =>
            h('button', {
              key: r.capsuleId,
              type: 'button',
              className: 'dfp-dock-pill is-on',
              title: t('dock.usePillHint', { title: r.title }),
              onClick: () => insertTextIntoComposer(inputActions, r.starterPrompt || `使用经验胶囊「${r.title}」执行任务`),
            },
              h('span', { className: 'dfp-dock-dot' }),
              h('span', { className: 'dfp-dock-pill-label' }, r.title)),
          ),
          activeCount === 0 && crystallized.slice(0, 2).map(c =>
            h('button', {
              key: c.capsuleId,
              type: 'button',
              className: 'dfp-dock-pill',
              title: t('dock.quickToggleHint'),
              onClick: () => quickUse(c),
            }, h('span', { className: 'dfp-dock-pill-label' }, `+ ${c.title}`)),
          ),
        )
      }
    }

    function createCapsuleHero(t) {
      return function FlowPackCapsuleHero(props) {
        const sessionId = props?.sessionId || ''
        const useSessions = props?.useSessions
        const inputActions = props?.inputActions
        const sessionRow = typeof useSessions === 'function' ? useSessions(s => s?.byId?.[sessionId]) : undefined
        const cwd = sessionRow?.cwd || ''
        const uiState = useCapsuleUi()
        const [activeCount, setActiveCount] = useState(0)

        useEffect(() => {
          fetchActivateLite(sessionId, cwd, uiState.syncVersion)
            .then(r => setActiveCount(Array.isArray(r.resolved) ? r.resolved.length : 0))
            .catch(() => {})
        }, [sessionId, cwd, uiState.syncVersion])

        return h('button', {
          type: 'button',
          className: `dfp-hero-pill dfp-theme ${activeCount > 0 ? 'is-armed' : ''}`,
          title: t('dock.tooltip'),
          onClick: () => capsuleUi.openPicker({ sessionId, cwd, inputActions }),
        },
          h(SparkIcon, { size: 13 }),
          h('span', null, activeCount > 0 ? t('hero.armed', { count: activeCount }) : t('hero.select')))
      }
    }

    function createCapsuleOverlay(t) {
      return function FlowPackCapsuleOverlay() {
        const ui = useCapsuleUi()
        const [scopeMode, setScopeMode] = useState('workspace')
        const [query, setQuery] = useState('')
        const [state, setState] = useState({ capsules: [], resolved: [], activations: null })
        const [busy, setBusy] = useState(false)
        const [statusMsg, setStatusMsg] = useState('')

        const reload = useCallback(() => {
          const q = new URLSearchParams({ sessionId: ui.sessionId || '', cwd: ui.cwd || '', lite: '1' })
          api(`/api/flowpack.activate?${q.toString()}`)
            .then(r => setState({
              capsules: Array.isArray(r.capsules) ? r.capsules : [],
              resolved: Array.isArray(r.resolved) ? r.resolved : [],
              activations: r.activations || null,
            }))
            .catch(() => {})
        }, [ui.sessionId, ui.cwd])

        useEffect(() => {
          if (ui.open) reload()
        }, [ui.open, ui.syncVersion, reload])

        useEffect(() => {
          if (!ui.open || typeof document === 'undefined') return undefined
          const onKey = (e) => {
            if (e.key === 'Escape') capsuleUi.closePicker()
          }
          document.addEventListener('keydown', onKey)
          return () => document.removeEventListener('keydown', onKey)
        }, [ui.open])

        if (!ui.open) return null

        const effectiveScope = !ui.cwd && scopeMode === 'workspace' ? 'global' : scopeMode
        const filteredCapsules = query.trim()
          ? state.capsules.filter(c => `${c.title} ${c.description || ''}`.toLowerCase().includes(query.trim().toLowerCase()))
          : state.capsules

        const handlePick = async (cap, insertPrompt) => {
          setBusy(true)
          setStatusMsg('')
          try {
            await api('/api/flowpack.activate', {
              method: 'POST',
              body: JSON.stringify({
                action: 'activate',
                capsuleId: cap.capsuleId,
                scope: effectiveScope,
                sessionId: ui.sessionId || '',
                cwd: ui.cwd || '',
                inheritSubagents: true,
              }),
            })
            if (insertPrompt) {
              const prompt = cap.executionPreset?.starterPrompt || `使用经验胶囊「${cap.title}」执行任务`
              insertTextIntoComposer(ui.inputActions, prompt)
            }
            capsuleUi.notifySync()
            reload()
            if (insertPrompt) capsuleUi.closePicker()
          } catch (err) {
            setStatusMsg(err.message)
          } finally {
            setBusy(false)
          }
        }

        const handleDeactivate = async (cap) => {
          setBusy(true)
          try {
            await api('/api/flowpack.activate', {
              method: 'POST',
              body: JSON.stringify({
                action: 'deactivate',
                capsuleId: cap.capsuleId,
                scope: 'all',
                sessionId: ui.sessionId || '',
                cwd: ui.cwd || '',
              }),
            })
            capsuleUi.notifySync()
            reload()
          } catch (err) {
            setStatusMsg(err.message)
          } finally {
            setBusy(false)
          }
        }

        const handleCrystallizeCurrent = async () => {
          if (!ui.sessionId) return setStatusMsg(t('msg.noSession'))
          setBusy(true)
          try {
            await api('/api/flowpack.capsules', {
              method: 'POST',
              body: JSON.stringify({
                action: 'crystallize',
                sessionId: ui.sessionId,
                crystallize: true,
                activate: true,
                scope: effectiveScope,
              }),
            })
            capsuleUi.notifySync()
            reload()
          } catch (err) {
            setStatusMsg(err.message)
          } finally {
            setBusy(false)
          }
        }

        const activeSet = new Set(state.resolved.map(r => r.capsuleId))

        return h('div', {
          className: 'dfp-overlay-backdrop dfp-theme',
          role: 'dialog',
          'aria-modal': 'true',
          onClick: (e) => { if (e.target === e.currentTarget) capsuleUi.closePicker() },
        },
          h('div', { className: 'dfp-overlay-card' },
            h('div', { className: 'dfp-overlay-head' },
              h('div', null,
                h('div', { className: 'dfp-overlay-title' }, h(SparkIcon, { size: 16 }), t('overlay.title')),
                h('div', { className: 'dfp-card-sub' }, t('overlay.subtitle'))),
              h('button', {
                type: 'button', className: 'dfp-icon-btn', 'aria-label': t('overlay.close'),
                onClick: () => capsuleUi.closePicker(),
              }, h(CloseIcon, { size: 16 }))),

            h('div', { className: 'dfp-overlay-toolbar' },
              h('input', {
                className: 'dfp-input',
                placeholder: t('overlay.searchPlaceholder'),
                value: query,
                onChange: e => setQuery(e.target.value),
              }),
              ui.sessionId ? h('button', {
                type: 'button', className: 'dfp-btn dfp-btn-soft', disabled: busy,
                onClick: handleCrystallizeCurrent,
              }, t('cap.crystallizeBtn')) : null),

            h('div', { className: 'dfp-scope-row' },
              h('span', { className: 'dfp-field-label' }, t('overlay.targetScope')),
              h('div', { className: 'dfp-scope-pills' },
                ['workspace', 'global', 'session'].map(sc =>
                  h('button', {
                    key: sc, type: 'button',
                    className: `dfp-scope-pill ${effectiveScope === sc ? 'is-on' : ''}`,
                    onClick: () => setScopeMode(sc),
                  }, t(`cap.scope.${sc}`)),
                ))),

            statusMsg ? h('div', { className: 'dfp-alert dfp-mt8' }, statusMsg) : null,

            h('div', { className: 'dfp-overlay-list dfp-mt10' },
              filteredCapsules.length === 0
                ? h('div', { className: 'dfp-empty-card' },
                  h('div', { className: 'dfp-empty-heading' }, t('cap.emptyTitle')),
                  h('p', { className: 'dfp-empty-desc' }, t('cap.empty')))
                : filteredCapsules.map(cap => {
                  const isOn = activeSet.has(cap.capsuleId)
                  const fixCount = cap.selfHealing?.rules?.length || 0
                  const genCount = cap.workflow?.genealogySummary?.length || 1
                  return h('div', { key: cap.capsuleId, className: `dfp-cap-card ${isOn ? 'is-mounted' : ''}` },
                    h('div', { className: 'dfp-cap-top' },
                      h('div', { className: 'dfp-cap-info' },
                        h('div', { className: 'dfp-cap-title-row' },
                          h('span', { className: 'dfp-cap-title' }, cap.title),
                          isOn ? h('span', { className: 'dfp-live-tag' }, t('cap.liveBadge')) : null),
                        renderMaturityMeter(cap, t)),
                      h('div', { className: 'dfp-btn-group' },
                        h('button', {
                          type: 'button', className: 'dfp-btn dfp-btn-primary dfp-btn-sm', disabled: busy,
                          onClick: () => handlePick(cap, true),
                        }, h(PlayIcon, { size: 11 }), t('cap.useNowBtn')),
                        !isOn ? h('button', {
                          type: 'button', className: 'dfp-btn dfp-btn-soft dfp-btn-sm', disabled: busy,
                          onClick: () => handlePick(cap, false),
                        }, t('overlay.armOnly')) : h('button', {
                          type: 'button', className: 'dfp-btn dfp-btn-danger-ghost dfp-btn-sm', disabled: busy,
                          onClick: () => handleDeactivate(cap),
                        }, t('overlay.disarm')))),
                    h('div', { className: 'dfp-cap-stats' },
                      h('span', null, t('cap.statFixes', { count: fixCount })),
                      h('span', { className: 'dfp-dot-sep' }, '·'),
                      h('span', null, t('cap.statGens', { count: genCount })),
                      h('span', { className: 'dfp-dot-sep' }, '·'),
                      h('span', null, `v${cap.version}`)),
                  )
                })),
          ),
        )
      }
    }

    function createSettingsSection(t) {
      return function FlowPackSettings() {
        const [form, setForm] = useState(null)
        const [paths, setPaths] = useState(null)
        const [saving, setSaving] = useState(false)
        const [status, setStatus] = useState('')

        useEffect(() => {
          api('/api/flowpack.settings')
            .then((v) => { setForm(v.settings); setPaths(v.paths) })
            .catch(() => {})
        }, [])

        if (!form) return h('div', { className: 'dfp-settings-loading' }, t('settings.loading'))

        const save = async () => {
          setSaving(true)
          setStatus('')
          try {
            const res = await api('/api/flowpack.settings', {
              method: 'POST',
              body: JSON.stringify({ settings: form }),
            })
            setForm(res.settings)
            setStatus(t('settings.saved'))
          } catch (err) {
            setStatus(err.message)
          } finally {
            setSaving(false)
          }
        }

        const update = (k, val) => setForm(prev => ({ ...prev, [k]: val }))
        const toggleRow = (key, labelKey, hintKey, defaultVal = true) =>
          h('label', { className: 'dfp-set-row' },
            h('div', { className: 'dfp-set-text' },
              h('span', { className: 'dfp-set-title' }, t(labelKey)),
              h('span', { className: 'dfp-set-hint' }, t(hintKey))),
            h('input', {
              type: 'checkbox',
              checked: defaultVal ? form[key] !== false : Boolean(form[key]),
              onChange: e => update(key, e.target.checked),
            }))

        return h('div', { className: 'dfp-settings dfp-theme' },
          h('div', { className: 'dfp-set-head' },
            h('h2', null, t('settings.title')),
            h('p', null, t('settings.description'))),

          h('div', { className: 'dfp-set-card' },
            h('h3', null, t('settings.groupLearning')),
            toggleRow('selfHealEnabled', 'settings.selfHeal', 'settings.selfHealHint', true),
            toggleRow('autoConsolidateOnIdle', 'settings.autoConsolidate', 'settings.autoConsolidateHint', true),
            toggleRow('subagentInheritance', 'settings.subagentInherit', 'settings.subagentInheritHint', true),
            toggleRow('autoDistillOnIdle', 'settings.autoDistillOnIdle', 'settings.autoDistillHint', false),
            h('div', { className: 'dfp-set-row' },
              h('div', { className: 'dfp-set-text' },
                h('span', { className: 'dfp-set-title' }, t('settings.crystallizeThreshold')),
                h('span', { className: 'dfp-set-hint' }, t('settings.crystallizeThresholdHint'))),
              h('input', {
                className: 'dfp-input dfp-input-sm', type: 'number', min: 1, max: 10,
                value: form.crystallizeThreshold || 3,
                onChange: e => update('crystallizeThreshold', Number(e.target.value) || 3),
              })),
          ),

          h('div', { className: 'dfp-set-card' },
            h('h3', null, t('settings.groupSecurity')),
            toggleRow('autoInject', 'settings.autoInject', 'settings.autoInjectHint', false),
            toggleRow('autoPackOnCompact', 'settings.autoPackOnCompact', 'settings.autoPackHint', false),
            toggleRow('requireSealedForInjection', 'settings.requireSealed', 'settings.requireSealedHint', false),
            toggleRow('strictMode', 'settings.strictMode', 'settings.strictModeHint', false),
            h('div', { className: 'dfp-set-row' },
              h('div', { className: 'dfp-set-text' },
                h('span', { className: 'dfp-set-title' }, t('settings.promptBudget')),
                h('span', { className: 'dfp-set-hint' }, t('settings.promptBudgetHint'))),
              h('input', {
                className: 'dfp-input dfp-input-sm', type: 'number', min: 400, max: 16000,
                value: form.promptBudgetChars,
                onChange: e => update('promptBudgetChars', Number(e.target.value) || 3600),
              })),
            h('div', { className: 'dfp-set-row' },
              h('div', { className: 'dfp-set-text' },
                h('span', { className: 'dfp-set-title' }, t('settings.redactSecrets')),
                h('span', { className: 'dfp-set-hint' }, t('settings.redactSecretsHint'))),
              h('select', { className: 'dfp-select-sm', value: form.redactSecrets, onChange: e => update('redactSecrets', e.target.value) },
                h('option', { value: 'mask' }, t('settings.redactMask')),
                h('option', { value: 'reject' }, t('settings.redactReject')),
                h('option', { value: 'off' }, t('settings.redactOff')))),
          ),

          paths ? h('div', { className: 'dfp-set-path' }, `${t('settings.storageDir')}: ${paths.rootDir}`) : null,
          h('div', { className: 'dfp-set-footer' },
            h('span', { className: 'dfp-muted' }, status),
            h('button', { type: 'button', className: 'dfp-btn dfp-btn-primary', disabled: saving, onClick: save }, t('settings.save'))),
        )
      }
    }

    /* ─────────────────────────── plugin setup ─────────────────────────── */

    const inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight']

    function safeSlot(ctx, label, registerFn) {
      try {
        return registerFn()
      } catch (err) {
        try { console.warn('[flowpack] slot skipped:', label, err) } catch { /* ignore */ }
        return () => {}
      }
    }

    function regSlot(ctx, slotName, meta, component) {
      const doReg = () => ctx.slots.register({ name: slotName, ...meta }, component)
      if (typeof ctx.slots.inject === 'function') {
        return ctx.slots.inject(slotName, doReg)
      }
      return doReg()
    }

    function apply(ctx) {
      ctx.locale.register(NS, { zh, en })
      const t = ctx.locale.bind(NS)

      const Panel = createPanel(ctx)
      const Title = createTitle(t)
      const HeaderEntry = createHeaderEntry(ctx, t)
      const ComposerEntry = createComposerEntry(ctx, t)
      const CapsuleDock = createCapsuleDock(ctx, t)
      const CapsuleHero = createCapsuleHero(t)
      const CapsuleOverlay = createCapsuleOverlay(t)
      const SettingsSection = createSettingsSection(t)

      ctx.effect(() => {
        if (typeof document === 'undefined') return undefined
        const style = document.createElement('style')
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'flowpack: styles')

      ctx.effect(() => {
        const res = ctx.sidebarRightTabs.register({
          id: ID,
          kind: KIND,
          priority: 'builtin',
          title: () => t('type.label'),
          guide: [{
            id: 'open',
            order: 35,
            title: () => t('guide.title'),
            description: () => t('guide.description'),
            icon: FlowGlyph,
          }],
        })
        return typeof res === 'function' ? res : () => res?.dispose?.()
      }, 'flowpack: tab')

      ctx.effect(() => safeSlot(ctx, 'header', () => regSlot(ctx, 'conversation.session.header.utilities', {
        id: 'flowpack.header', order: 24, locale: NS,
      }, HeaderEntry)), 'flowpack: header')

      ctx.effect(() => safeSlot(ctx, 'composer', () => regSlot(ctx, 'conversation.input.left', {
        id: 'flowpack.composer', order: 24, locale: NS,
      }, ComposerEntry)), 'flowpack: composer')

      ctx.effect(() => safeSlot(ctx, 'capsule-dock', () => regSlot(ctx, 'conversation.composer.dock', {
        id: 'flowpack.capsule-dock', order: 52, locale: NS,
      }, CapsuleDock)), 'flowpack: capsule-dock')

      ctx.effect(() => safeSlot(ctx, 'capsule-hero', () => regSlot(ctx, 'conversation.hero.options', {
        id: 'flowpack.capsule-hero', order: 42, locale: NS,
      }, CapsuleHero)), 'flowpack: capsule-hero')

      ctx.effect(() => safeSlot(ctx, 'capsule-overlay', () => regSlot(ctx, 'shell.overlay', {
        id: 'flowpack.capsule-overlay', order: 52, locale: NS,
      }, CapsuleOverlay)), 'flowpack: capsule-overlay')

      ctx.effect(() => safeSlot(ctx, 'settings', () => regSlot(ctx, 'settings.section', {
        id: 'flowpack.settings', order: 26, label: () => t('settings.title'), locale: NS,
      }, SettingsSection)), 'flowpack: settings')

      ctx.effect(() => safeSlot(ctx, 'panel', () => regSlot(ctx, 'sidebar.right.pane.tab', {
        key: ID, locale: NS,
      }, Panel)), 'flowpack: panel')

      ctx.effect(() => safeSlot(ctx, 'title', () => regSlot(ctx, 'sidebar.right.pane.tab.title', {
        key: ID, locale: NS,
      }, Title)), 'flowpack: title')
    }

    /* ─────────────────────────── locales (100% plain language) ─────────────────────────── */

    const zh = {
      'type.label': '经验与记忆',
      'header.open': '打开 FlowPack 经验按键与记忆面板',
      'header.armedBadge': '{count} 个生效中',
      'header.sourceChat': '当前对话',
      'entry.label': '经验按键',
      'guide.title': '可复用经验按键与防忘记忆',
      'guide.description': '把干成一件事的经验存成按键：下次点一下就开工，跨对话、派子助手都自带避坑规则与历史底稿。',

      'tab.capsules': '经验按键',
      'tab.memory': '重要记忆',
      'tab.train': '示教训练',
      'tab.advanced': '更多工具',

      'adv.portability': '导入与迁移',
      'adv.injection': 'AI 实收上下文',
      'adv.workflows': '工作流微调',

      'btn.refresh': '刷新',
      'btn.verifyAll': '检查完整性',
      'btn.delete': '删除',
      'btn.copy': '复制内容',
      'btn.collapse': '收起',
      'btn.sendComposer': '放到输入框',

      'maturity.exploring': '初学摸索',
      'maturity.emerging': '逐渐熟练',
      'maturity.crystallized': '已成套路',

      'cap.activeBannerTitle': '当前对话已启用 {count} 个经验（派出的子助手也会自动带上）',
      'cap.manageBtn': '管理开关',
      'cap.captureTitle': '从刚才的对话学一招',
      'cap.captureHint': 'AI 帮您干完一件事后，点按钮即可攒成以后一键复用的“经验按键”。',
      'cap.titlePlaceholder': '给这招起个好记的名字（留空自动命名）…',
      'cap.learnBtn': '记 1 次练习',
      'cap.crystallizeBtn': '直接存为经验按键',
      'cap.openPicker': '全部按键选择器',
      'cap.emptyTitle': '还没有攒下任何经验按键',
      'cap.empty': '您不用做复杂设置：像平时一样让 AI 完成一次工作，再点上面【直接存为经验按键】，它就会记住这套做法、遇到的坑和最初步骤。',
      'cap.step1': '像平时一样在对话里完成一次任务',
      'cap.step2': '点击上方按钮存为你的专属“经验按键”',
      'cap.step3': '以后开新对话点一下按键即可开工，出错会自动纠偏',
      'cap.libraryTitle': '我的经验按键 ({count})',
      'cap.liveBadge': '生效中',
      'cap.useQuickBtn': '用它开工',
      'cap.statSteps': '{count} 步做法',
      'cap.statFixes': '{count} 条避坑',
      'cap.statGens': '留存 {count} 个版本',
      'cap.makeButton': '立即升格为可用按键',
      'cap.scopeQuestion': '在哪些地方自动开启这个经验？',
      'cap.subagentAuto': '含派出的子助手',
      'cap.scope.session': '仅此对话',
      'cap.scope.workspace': '当前项目全部对话',
      'cap.scope.global': '所有对话与助手通用',
      'cap.scopeShort.session': '仅此对话',
      'cap.scopeShort.workspace': '本项目',
      'cap.scopeShort.global': '全局通用',
      'cap.useNowBtn': '开启并放到输入框准备开工',

      'cap.sub.route': '做法与历史底稿',
      'cap.sub.selfheal': '避坑与分享',
      'cap.sub.export': '带走与分享',

      'cap.backList': '返回全部经验',
      'cap.toggleCustomName': '自起名字',
      'cap.hideCustomName': '自动起名',
      'cap.recapBadge': '我刚记住了这招',
      'cap.recapTitle': '我学会并起好了名字',
      'cap.recapGoalLabel': '理解的目标：',
      'cap.recapStepsLabel': '记住的做法：',
      'cap.recapFixesLabel': '避坑要点：',
      'cap.recapNoFixesYet': '之后若遇错并解决过，会自动补记到这里',
      'cap.recapViewDetail': '看详情',
      'cap.recapWhatILearned': '我记住了什么',
      'cap.renameBtn': '改名',
      'cap.renamePlaceholder': '输入好记的新名字…',
      'cap.saveBtn': '保存',
      'cap.cancelBtn': '取消',
      'cap.refreshFromChat': '重新理解当前对话',
      'cap.armedPill': '已开启',
      'cap.armPill': '点此开启',
      'cap.macroTitle': '标准执行大步（已自动归纳）',
      'cap.rawToggleShow': '展开查看底层 {count} 步详细操作',
      'cap.rawToggleHide': '收起底层详细操作',
      'cap.rawMoreNotice': '当前显示前 {shown} 步，共 {total} 步',
      'cap.rawShowAllBtn': '显示全部',
      'cap.exportSectionTitle': '带走与跨平台分享',
      'cap.exportToggleShow': '展开导出格式与跨平台分享',
      'cap.exportToggleHide': '收起导出格式',
      'cap.loadingDetail': '正在加载详细内容…',

      'macro.prepare': '准备权限与环境',
      'macro.discover': '查阅与定位资料',
      'macro.gui': '桌面窗口操作',
      'macro.web': '网页采集与核对',
      'macro.spreadsheet': '整理与汇总表格',
      'macro.document': '撰写与编辑文档',
      'macro.verify': '检查与核对结果',
      'macro.deliver': '生成成果与收尾',
      'sum.stageOps': '完成 {count} 次操作（{tools}）',
      'sum.headline': '归纳为 {macro} 大步（提炼自 {raw} 次操作）· {fixes} 条避坑',
      'sum.stepCountShort': '{count} 大步',

      'cap.routeTitle': '现在的标准执行路线',
      'cap.noSteps': '暂未拆解出固定步骤（点击刷新或积累一次工具调用后自动生成）。',
      'cap.defaultStep': '第 {n} 步',
      'cap.parallelTag': '可同时执行',
      'cap.historyTitle': '历史演变（永远保留最初版本，不会遗忘）',
      'cap.genFirst': '第 {gen} 版 · 最初探索底稿',
      'cap.genLabel': '第 {gen} 版 · 优化后',
      'cap.genCurrent': '当前使用',
      'cap.genStats': '共 {steps} 步 · 防呆护栏 {guardrails} 条',
      'cap.restoreGenBtn': '恢复用这版',

      'gen.action.init': '初版保留',
      'gen.action.reinforce': '叠加强化',
      'gen.action.self_heal': '融入排错经验',
      'gen.action.restore': '回退复用',
      'gen.action.optimize': '精简提速',

      'cap.healListTitle': '遇到的坑与自动纠错方法',
      'cap.addFixTrigger': '+ 教它一条新避坑',
      'cap.fixToolPlaceholder': '工具名称（或填 * ）',
      'cap.fixSymptomPlaceholder': '之前遇到什么报错/卡点…',
      'cap.fixResolutionPlaceholder': '改成什么做法能成功…',
      'cap.addFixBtn': '保存解法',
      'cap.noRules': '暂时还没记录报错解法。之后使用中一旦遇到报错又成功改过，系统会自动学会并记在这里。',
      'cap.whenErr': '遇到问题',
      'cap.autoFix': '自动换招',
      'cap.fallbackHint': '如新解法仍受阻，会自动提示对照第 {gen} 版旧方案',
      'cap.pluginsTitle': '已自动联动的其他插件能力 ({count} 个工具)',
      'cap.recentHealEvents': '最近刚生效的自动纠错记录',
      'plugin.office': '文档 (Word)',
      'plugin.excel': '表格 (Excel)',
      'plugin.gui': '桌面控制',
      'plugin.workbuddy': 'WorkBuddy',
      'plugin.fileLauncher': '文件助手',
      'plugin.flowpack': '经验与记忆',

      'export.fmt.dshcapsule': 'DSH 经验完整包',
      'export.fmt.skill': '通用 Agent 技能',
      'export.fmt.agentsMd': '团队规范文档',
      'export.fmt.ptc': 'DSH 并行脚本',
      'export.fmt.markdown': '易读说明书',

      'dock.tooltip': '选择或切换工作流经验按键（可跨对话、跨子助手自带避坑规则）',
      'dock.activeLabel': '经验按键 · {count}',
      'dock.pickLabel': '选择经验',
      'dock.quickToggleHint': '点击开启这个经验（跨对话和子助手通用）',
      'dock.usePillHint': '已开启「{title}」，点击将开工提示词填入输入框',
      'hero.armed': '已带 {count} 个经验按键',
      'hero.select': '用我攒下的经验开工',

      'overlay.title': '选择要启用的经验按键',
      'overlay.subtitle': '点选后立即对当前对话及派生子助手生效；遇错自动对照历史解法纠偏，绝不丢弃旧版本。',
      'overlay.close': '关闭',
      'overlay.searchPlaceholder': '搜索经验名称或用途…',
      'overlay.targetScope': '生效范围：',
      'overlay.armOnly': '仅后台开启',
      'overlay.disarm': '取消开启',

      'mem.noteTitle': '记下红线规则、重要路径或踩坑记录',
      'mem.strictNote': '记住后即便对话被压缩也不会忘，且带防篡改保护（可放心跨对话携带）。',
      'mem.packSessionBtn': '一键从本次对话整理',
      'mem.pinPlaceholder': '输入必须让 AI 牢记的一句话，例如：不要修改 D:/prod 目录…',
      'mem.pinBtn': '记住',
      'mem.sealBtn': '加锁确认',
      'mem.emptyTitle': '还没有记下重要笔记',
      'mem.empty': '在上方写下一条红线或重要事实点「记住」，或者点「一键从本次对话整理」。',
      'mem.entryCount': '{count} 条笔记',
      'mem.sealedTag': '已防篡改',
      'mem.draftTag': '草稿',
      'mem.workspaceLabel': '所属项目',
      'mem.globalLabel': '全局 / 个人随身笔记',
      'mem.quarantineTitle': '已安全拦截 {count} 份内容被改动过的记忆文件',
      'mem.archives': '历史留存版本（点击即可退回）',
      'mem.backList': '返回记忆列表',
      'mem.listCount': '我的记忆本 ({count})',
      'mem.guideTitle': '记忆里存的到底是什么？（和经验按键有啥区别）',
      'mem.guideShow': '展开说明',
      'mem.guideHide': '收起说明',
      'mem.guideLine1': '「经验按键」记住任务怎么做（多步流程与遇错换招）；「重要记忆」记住绝对不能忘的项目规则、关键事实、决策和踩坑教训。',
      'mem.guideLine2': '点「一键从本次对话整理」、手动在下方记一条，或长对话发生自动压缩前，系统都会自动提炼并保存成带防篡改指纹的记忆本。',
      'mem.guideLine3': '每份记忆本都会在下个回合或新对话自动喂给 AI；点任意记忆本即可看里面每一条明细、退回历史版本或发给 AI。',
      'mem.recapBadge': '我刚记住的笔记内容',
      'mem.viewDetail': '查看明细',
      'mem.sumHeadline': '共 {count} 条：{parts}',
      'mem.sumEmpty': '暂无内容（可点「一键从本次对话整理」或在下方直接记一条）',

      'sec.constraints': '红线与要求',
      'sec.facts': '事实与路径',
      'sec.decisions': '定下来的方案',
      'sec.pitfalls': '踩过的坑',
      'sec.workflows': '关联做法',
      'sec.checkpoints': '交接下一步',
      'secHint.constraints': '红线规则：AI 必须严格遵守，不可违反的禁止项或边界',
      'secHint.facts': '关键事实：已核实的文件路径、参数、接口地址或环境事实',
      'secHint.decisions': '关键决策：已经拍板确定的架构、方案或取舍结论',
      'secHint.pitfalls': '踩坑教训：之前试错验证过的弯路与避坑要点',
      'secHint.workflows': '关联做法：与本次记忆配合使用的操作惯例或入口',
      'secHint.checkpoints': '下一步交接：还没收尾的待办事项与交接状态',

      'prio.critical': '必须牢记',
      'prio.high': '优先记住',
      'prio.normal': '普通参考',

      'inj.title': '每次对话自动传给 AI 的背景容量',
      'inj.empty': '当前对话下暂无自动附带的经验或记忆内容。',
      'inj.statChars': '已用 {used} / {max} 字符',
      'inj.statCaps': '生效经验 {count} 个',
      'inj.statPacks': '生效记忆本 {count} 份',

      'port.capsuleExportTitle': '导出选中经验包 (.dshcapsule.json)',
      'port.copyCapsuleJson': '复制完整包',
      'port.exportTitle': '导出选中记忆本 (.dshpack.json)',
      'port.copyJson': '复制记忆本',
      'port.importTitle': '从其他电脑或分享中导入',
      'port.importHint': '粘贴他人分享的 .dshcapsule.json 经验包或 .dshpack.json 记忆包，自动验签后导入。',
      'port.importPlaceholder': '在此粘贴导出的 JSON 内容…',
      'port.importBtn': '验证并导入',

      'wf.titlePlaceholder': '工作流名称（留空自动生成）',
      'wf.distillBtn': '从当前对话提炼流程',
      'wf.empty': '还没有手动提炼的工作流。',
      'wf.promoteBtn': '注册为 Skill',
      'wf.demoteBtn': '取消 Skill',
      'wf.guardrailPlaceholder': '补充一条防呆规则后重新精炼…',
      'wf.optimizeBtn': '优化一步',
      'wf.view.stages': '步骤视图',
      'wf.view.skill': 'SKILL.md',
      'wf.view.script': 'DSH PTC 脚本',

      'settings.title': '经验与记忆 (FlowPack)',
      'settings.loading': '正在读取设置…',
      'settings.description': '调整经验按键的养成门槛、遇错自动纠偏方式，以及长期记忆的保护策略。',
      'settings.groupLearning': '学习养成与自动纠偏',
      'settings.groupSecurity': '记忆加载与安全保护',
      'settings.strictMode': '严格检查记忆来源',
      'settings.strictModeHint': '要求每条长期记忆都可追溯具体来源与版本，避免混入无效垃圾内容。',
      'settings.autoInject': '新对话和每轮问答自动携带已开启经验',
      'settings.autoInjectHint': '让 AI 始终记得您点选开启的经验按键与项目红线。',
      'settings.autoPackOnCompact': '对话被长文本压缩前自动保存一次记忆',
      'settings.autoPackHint': '防止聊太长发生上下文压缩后忘掉关键信息。',
      'settings.autoDistillOnIdle': '每轮对话空闲后自动草拟流程总结',
      'settings.autoDistillHint': '适合需要事后细看每段工具调用拆解的用户。',
      'settings.requireSealed': '只允许未篡改的已加锁内容生效',
      'settings.requireSealedHint': '如果发现本地记录被意外改坏，自动屏蔽以保证安全。',
      'settings.selfHeal': '工具报错时实时注入历史纠错建议',
      'settings.selfHealHint': '无论主助手还是子助手，一旦出错立即从过往经验里找替代做法。',
      'settings.autoConsolidate': '挂载经验跑通任务后自动叠加熟练度',
      'settings.autoConsolidateHint': '用得越多越牢靠，遇到新错再绕通也会自动记住新解法。',
      'settings.subagentInherit': '派出的子助手自动继承当前对话开启的经验',
      'settings.subagentInheritHint': '跨 Agent 委派任务时不用重新叮嘱，直接继承套路与避坑规则。',
      'settings.crystallizeThreshold': '练成常用经验按键所需的成功次数',
      'settings.crystallizeThresholdHint': '同一类工作跑通指定次数后自动升格为标准经验按键（也可随时手动立即存）。',
      'settings.promptBudget': '每次对话注入背景字数上限',
      'settings.promptBudgetHint': '控制传给 AI 的经验与记忆长度，平衡准确度与窗口空间（默认 3600）。',
      'settings.redactSecrets': '隐私密钥/Token 防护方式',
      'settings.redactSecretsHint': '避免 API Key 或密码被意外写进经验包带走分享。',
      'settings.redactMask': '自动打码脱敏（推荐）',
      'settings.redactReject': '检测到密钥直接拒绝保存',
      'settings.redactOff': '关闭检测',
      'settings.storageDir': '本地存储位置',
      'settings.save': '保存设置',
      'settings.saved': '已保存设置',

      'msg.noSessionOption': '暂无可选对话',
      'msg.unnamedSession': '当前对话',
      'msg.noSession': '请先打开或选择一个对话',
      'msg.distilled': '已提炼「{name}」· 评分 {score}/100',
      'msg.optimized': '已精炼升级到 v{ver}',
      'msg.promoted': '已启用为运行时 Skill',
      'msg.demoted': '已取消运行时 Skill',
      'msg.deleted': '已删除',
      'msg.packed': '已整理并加锁保存：「{title}」',
      'msg.pinned': '已记住并加锁',
      'msg.sealed': '已加锁确认',
      'msg.verified': '完整性检查完成：正常 {passed} 份，异常 {failed} 份，新拦截 {q} 份',
      'msg.rolledBack': '已恢复到历史版本 v{ver}',
      'msg.imported': '验签通过并成功导入「{title}」',
      'msg.inserted': '已放到输入框，可以直接发送开始干活啦',
      'msg.copied': '已复制到剪贴板',
      'msg.copyFailed': '复制失败',
      'msg.capLearned': '已记住经验「{title}」（累计第 {attempts} 次）',
      'msg.capToggled': '已切换生效范围：{scope}',
      'msg.capDisarmed': '已取消开启该经验按键',
      'msg.capCrystallized': '已存为经验按键并开启！',
      'msg.fixRecorded': '已记住一条新避坑做法（之前的旧版本也完整留着）',
      'msg.genRestored': '已恢复采用第 {gen} 版做法（其他更新版本也仍保留在历史中）',
      'msg.emptyName': '请先输入新名称',
      'msg.renamed': '已改名为「{title}」',
      'msg.refreshedCap': '已重新理解并整理「{title}」',

      'train.heroTitle': '我来操作一遍，AI 边看边学边练直到学会',
      'train.heroDesc': '开启后正常在桌面上操作，AI 会实时记录步骤与画面并随时向你提问；操作完交给 AI 实战演练几轮（允许采用更快更好的替代方法），你批注查收正确后，一键固化为经验按键与重要记忆。',
      'train.titlePh': '起个任务名（可留空，AI 会自动命名）',
      'train.goalPh': '最终交付要求或验收标准（例如：整理成 xlsx 并核对总数一致）',
      'train.autoQToggle': '看屏学习遇到歧义或关键点时，AI 实时向我提问',
      'train.startWatchBtn': '开始看我操作（实时屏幕学习）',
      'train.newManualBtn': '新建纯训练任务单',
      'train.unsupportedHint': '当前平台不支持底层桌面实时看屏捕获；你仍可用下方手动补步骤 + AI 提问与多轮训练。',
      'train.activeWatchBanner': '正在实时看屏录制',
      'train.enterWatchBtn': '回到录制页',
      'train.listTitle': '历史示教与训练任务',
      'train.empty': '还没有示教训练记录。点击上方「开始看我操作」，像带新人一样示范一次，AI 就会学着干活并让你验收。',
      'train.stepCount': '{count} 步示教',
      'train.roundCount': '{count} 轮训练',
      'train.pendingQBadge': '待答 {count} 问',
      'train.betterFoundBadge': '找到更优方案',
      'train.backToList': '返回训练列表',
      'train.renameBtn': '改名',
      'train.saveNameBtn': '保存',
      'train.cancelBtn': '取消',
      'train.deleteBtn': '删除',
      'train.status.watching': '正在看屏学习',
      'train.status.ready': '待交给 AI 训练',
      'train.status.training': 'AI 实操训练中',
      'train.status.graduated': '已验收出师',
      'train.watchingStatus': '正在实时学习你的操作（已捕获 {count} 步 · 自动跳过本窗口与密码输入）',
      'train.captureNowBtn': '立刻抓拍一帧',
      'train.aiAskBtn': '让 AI 看屏提问',
      'train.finishDemoBtn': '我操作完了，准备训练',
      'train.resumeWatchBtn': '继续看屏补录示范',
      'train.aiReviewBtn': '让 AI 复盘看懂并找更优解',
      'train.aiSummaryTitle': 'AI 当前理解的工作目标与做法',
      'train.aiNoSummaryYet': '暂未总结（操作几步后可点上方「让 AI 看屏提问」或直接交给 AI 练一轮）。',
      'train.betterTitle': 'AI 发现了更快/更稳的替代方法',
      'train.questionsTitle': 'AI 实时提问与你的澄清',
      'train.questionsEmpty': 'AI 目前暂无疑问；继续操作或点「让 AI 看屏提问」，有歧义时问题会出现在这里。',
      'train.answerPh': '直接回答 AI 的疑问，这个规则会长期记住…',
      'train.answerBtn': '回答并记住',
      'train.skipQBtn': '跳过',
      'train.answeredTag': '已记住回答',
      'train.skippedTag': '已跳过',
      'train.stepsTitle': '人类操作示范时间线（{count} 步）',
      'train.stepsEmpty': '暂无示范步骤；正在录制时切出去操作就会自动记录，也可直接在下方补一句说明。',
      'train.viewFrame': '查看画面',
      'train.hideFrame': '收起画面',
      'train.stepNotePh': '可选：给这一步补充注意点或避坑批注…',
      'train.saveNoteBtn': '存批注',
      'train.addStepPh': '补充一步人类示范说明（例如：右键导出为 CSV）…',
      'train.addStepBtn': '加入步骤',
      'train.roundsTitle': 'AI 实操训练与你的查收批注（{count} 轮）',
      'train.roundsHint': '每轮允许 AI 使用脚本/命令行等更优替代方案完成，只要最终交付结果一致并由你查收正确即可。',
      'train.coachPh': '给 AI 写本轮批注/纠正/要求（例如：不用人工一个个点，直接用 Python 批量处理后核对结果）…',
      'train.startRoundBtn': '交给 AI 开始第 {next} 轮训练',
      'train.syncRoundBtn': '从当前对话录入一轮结果',
      'train.graduateDirectBtn': '直接固化成经验按键与记忆',
      'train.roundsEmpty': '还没开始 AI 实操训练。点上方蓝色按钮把示范与你的澄清塞进对话框，发给 AI 跑第一轮吧。',
      'train.roundHeader': '第 {no} 轮训练',
      'train.methodBetter': 'AI 采用更优替代方案',
      'train.methodDemo': '按示范流程复现',
      'train.verdict.accepted': '查收正确',
      'train.verdict.needs_fix': '批注需重练',
      'train.verdict.practice': '不错再练一轮',
      'train.verdict.pending': '待你查收批注',
      'train.humanNotePrefix': '你的批注：',
      'train.fixNextBtn': '批注问题并重练下一轮',
      'train.practiceMoreBtn': '不错，再练巩固一轮',
      'train.acceptAndGraduateBtn': '查收正确！形成经验与记忆',
      'train.graduatedTitle': '太棒了！已形成长期经验按键与重要记忆',
      'train.graduatedDesc': '第 1 代保留你的人类示范基准，第 2 代固化 AI 验收通过的最优方法与全部批注避坑，以后换对话或子助手也能直接一键启用并自我纠错。',
      'train.openCapsuleBtn': '打开经验按键',
      'train.openMemoryBtn': '查看重要记忆',

      'msg.trainWatching': '已开启实时看屏学习！切出去正常操作即可（自动跳过 DSH 与密码框）',
      'msg.trainCreated': '已创建训练任务单',
      'msg.trainWatchFallback': '实时屏幕钩子未启用（{warn}），已进入手动/补充训练模式',
      'msg.trainCaptured': '已补抓当前操作与画面',
      'msg.trainQuestionRaised': '已抓拍，且 AI 提出了一个问题等你回答！',
      'msg.trainStopped': '已停止屏幕监听，现在可以交给 AI 开始实战训练',
      'msg.trainStepAdded': '已添加示范步骤',
      'msg.trainNoteSaved': '已保存这一步的批注',
      'msg.trainAiReviewed': 'AI 已完成看屏复盘',
      'msg.trainAiReviewUnavailable': '当前无可用视觉模型复盘，已保留规则理解',
      'msg.trainQuestionAnswered': 'AI 已记住你的解答！',
      'msg.trainQuestionSkipped': '已跳过该问题',
      'msg.trainRoundPrepared': '第 {no} 轮训练指令已填入对话输入框，点击发送让 AI 开练！',
      'msg.trainRoundRecorded': '已从当前对话整理并记入一轮训练结果',
      'msg.trainNextRoundReady': '已记下你的批注，下一轮改进指令已放入输入框！',
      'msg.trainAnnotated': '已保存你对本轮训练的批注',
      'msg.trainGraduated': '「{title}」已出师！同时生成了经验按键与重要记忆',
    }

    const en = {
      'type.label': 'Capsules & Memory',
      'header.open': 'Open FlowPack Capsules & Memory panel',
      'header.armedBadge': '{count} armed',
      'header.sourceChat': 'Source chat',
      'entry.label': 'Capsules',
      'guide.title': 'Reusable Experience Buttons & Compaction-Proof Memory',
      'guide.description': 'Save a successful workflow as a clickable button: reuse across chats and subagents with automatic self-healing and full version history.',

      'tab.capsules': 'Capsules',
      'tab.memory': 'Memory Notes',
      'tab.train': 'Watch & Train',
      'tab.advanced': 'More Tools',

      'adv.portability': 'Import / Export',
      'adv.injection': 'Live Context',
      'adv.workflows': 'Workflows',

      'btn.refresh': 'Refresh',
      'btn.verifyAll': 'Verify Integrity',
      'btn.delete': 'Delete',
      'btn.copy': 'Copy',
      'btn.collapse': 'Collapse',
      'btn.sendComposer': 'Insert Prompt',

      'maturity.exploring': 'Exploring',
      'maturity.emerging': 'Learning',
      'maturity.crystallized': 'Ready Button',

      'cap.activeBannerTitle': '{count} capsule(s) active here (inherited by spawned subagents)',
      'cap.manageBtn': 'Manage',
      'cap.captureTitle': 'Learn from this conversation',
      'cap.captureHint': 'Once the AI completes a task, save the routine as a one-click reusable button.',
      'cap.titlePlaceholder': 'Name this experience (auto if blank)...',
      'cap.learnBtn': 'Log Practice',
      'cap.crystallizeBtn': 'Save as Capsule Button',
      'cap.openPicker': 'Open Picker Modal',
      'cap.emptyTitle': 'No Experience Capsules Yet',
      'cap.empty': 'Just work normally with the AI, then click "Save as Capsule Button" above to capture the workflow, fixes, and baseline.',
      'cap.step1': 'Complete any task in a conversation',
      'cap.step2': 'Click the button above to save your experience capsule',
      'cap.step3': 'Pick it in any future chat or subagent to start immediately',
      'cap.libraryTitle': 'My Experience Library ({count})',
      'cap.liveBadge': 'Active',
      'cap.useQuickBtn': 'Use Now',
      'cap.statSteps': '{count} steps',
      'cap.statFixes': '{count} fixes',
      'cap.statGens': '{count} versions kept',
      'cap.makeButton': 'Promote to Ready Button',
      'cap.scopeQuestion': 'Where should this experience stay active?',
      'cap.subagentAuto': 'Auto-shared with subagents',
      'cap.scope.session': 'This Chat Only',
      'cap.scope.workspace': 'This Project',
      'cap.scope.global': 'All Chats & Agents',
      'cap.scopeShort.session': 'This Chat',
      'cap.scopeShort.workspace': 'Project',
      'cap.scopeShort.global': 'Global',
      'cap.useNowBtn': 'Enable & Insert Starter Prompt',

      'cap.sub.route': 'Steps & History',
      'cap.sub.selfheal': 'Fixes & Share',
      'cap.sub.export': 'Share / Export',

      'cap.backList': 'Back to List',
      'cap.toggleCustomName': 'Custom Name',
      'cap.hideCustomName': 'Auto Name',
      'cap.recapBadge': 'Just Learned',
      'cap.recapTitle': 'Learned & Auto-Named',
      'cap.recapGoalLabel': 'Task Goal: ',
      'cap.recapStepsLabel': 'Workflow Steps:',
      'cap.recapFixesLabel': 'Self-Healing Notes: ',
      'cap.recapNoFixesYet': 'Future error recoveries will be recorded automatically',
      'cap.recapViewDetail': 'Details',
      'cap.recapWhatILearned': 'What I Learned',
      'cap.renameBtn': 'Rename',
      'cap.renamePlaceholder': 'Enter a clear memorable name...',
      'cap.saveBtn': 'Save',
      'cap.cancelBtn': 'Cancel',
      'cap.refreshFromChat': 'Re-analyze Chat',
      'cap.armedPill': 'Active',
      'cap.armPill': 'Enable',
      'cap.macroTitle': 'Key Workflow Stages',
      'cap.rawToggleShow': 'Show {count} raw tool calls',
      'cap.rawToggleHide': 'Hide raw tool calls',
      'cap.rawMoreNotice': 'Showing first {shown} of {total} stages',
      'cap.rawShowAllBtn': 'Show all',
      'cap.exportSectionTitle': 'Export & Cross-Platform Share',
      'cap.exportToggleShow': 'Show Export Formats & Share',
      'cap.exportToggleHide': 'Hide Export Formats',
      'cap.loadingDetail': 'Loading full details...',

      'macro.prepare': 'Prepare & Permissions',
      'macro.discover': 'Read & Discover',
      'macro.gui': 'Desktop GUI Actions',
      'macro.web': 'Web & Fetch',
      'macro.spreadsheet': 'Spreadsheet Work',
      'macro.document': 'Edit Documents',
      'macro.verify': 'Verify Results',
      'macro.deliver': 'Deliver Output',
      'sum.stageOps': '{count} action(s) via {tools}',
      'sum.headline': '{macro} key stages (from {raw} ops) · {fixes} fixes',
      'sum.stepCountShort': '{count} stages',

      'cap.routeTitle': 'Current Execution Route',
      'cap.noSteps': 'No structured steps captured yet.',
      'cap.defaultStep': 'Stage {n}',
      'cap.parallelTag': 'Runs in parallel',
      'cap.historyTitle': 'Version History (Never forgets earlier workflows)',
      'cap.genFirst': 'Gen {gen} · Original Baseline',
      'cap.genLabel': 'Gen {gen} · Evolved',
      'cap.genCurrent': 'Current',
      'cap.genStats': '{steps} steps · {guardrails} guardrails',
      'cap.restoreGenBtn': 'Restore This Version',

      'gen.action.init': 'Baseline',
      'gen.action.reinforce': 'Reinforced',
      'gen.action.self_heal': 'Fix Learned',
      'gen.action.restore': 'Restored',
      'gen.action.optimize': 'Optimized',

      'cap.healListTitle': 'Known Errors & Self-Healing Fixes',
      'cap.addFixTrigger': '+ Teach a Fix',
      'cap.fixToolPlaceholder': 'Tool (or *)',
      'cap.fixSymptomPlaceholder': 'Error / symptom encountered...',
      'cap.fixResolutionPlaceholder': 'Working fix or alternative...',
      'cap.addFixBtn': 'Save Fix',
      'cap.noRules': 'No error fixes saved yet; future error recoveries will be learned automatically.',
      'cap.whenErr': 'On Error',
      'cap.autoFix': 'Auto Fix',
      'cap.fallbackHint': 'If still blocked, falls back to Gen {gen} baseline automatically',
      'cap.pluginsTitle': 'Detected Plugin Capabilities ({count} tools)',
      'cap.recentHealEvents': 'Recent Runtime Self-Healing Events',
      'plugin.office': 'Word / Docs',
      'plugin.excel': 'Excel / Sheets',
      'plugin.gui': 'Desktop GUI Control',
      'plugin.workbuddy': 'WorkBuddy',
      'plugin.fileLauncher': 'File Launcher',
      'plugin.flowpack': 'FlowPack',

      'export.fmt.dshcapsule': 'DSH Capsule',
      'export.fmt.skill': 'SKILL.md',
      'export.fmt.agentsMd': 'AGENTS.md',
      'export.fmt.ptc': 'DSH PTC Script',
      'export.fmt.markdown': 'Manual (.md)',

      'dock.tooltip': 'Select Experience Capsules across chats & spawned subagents',
      'dock.activeLabel': 'Capsules · {count}',
      'dock.pickLabel': 'Pick Capsule',
      'dock.quickToggleHint': 'Click to arm across this project and subagents',
      'dock.usePillHint': '"{title}" is active — click to insert starter prompt',
      'hero.armed': '{count} Capsule(s) Ready',
      'hero.select': 'Start with an Experience Capsule',

      'overlay.title': 'Choose Experience Capsule',
      'overlay.subtitle': 'Activate any capsule for this chat and spawned subagents with automatic self-healing.',
      'overlay.close': 'Close',
      'overlay.searchPlaceholder': 'Search capsules...',
      'overlay.targetScope': 'Apply to:',
      'overlay.armOnly': 'Enable Only',
      'overlay.disarm': 'Disable',

      'mem.noteTitle': 'Save Important Rules, Facts, or Pitfalls',
      'mem.strictNote': 'Survives context compaction with tamper-evident protection.',
      'mem.packSessionBtn': 'Auto-Capture This Chat',
      'mem.pinPlaceholder': 'Write a rule or fact the AI must never forget...',
      'mem.pinBtn': 'Save Note',
      'mem.sealBtn': 'Lock & Seal',
      'mem.emptyTitle': 'No Memory Notes Saved Yet',
      'mem.empty': 'Write an important note above or click "Auto-Capture This Chat".',
      'mem.entryCount': '{count} notes',
      'mem.sealedTag': 'Protected',
      'mem.draftTag': 'Draft',
      'mem.workspaceLabel': 'Project',
      'mem.globalLabel': 'Global / Session Notes',
      'mem.quarantineTitle': 'Quarantined {count} tampered/corrupt memory pack(s)',
      'mem.archives': 'Saved Snapshots (click to restore)',
      'mem.backList': 'Back to Notes',
      'mem.listCount': 'My Memory Packs ({count})',
      'mem.guideTitle': 'What is inside Memory Notes? (vs Experience Capsules)',
      'mem.guideShow': 'Show Guide',
      'mem.guideHide': 'Hide Guide',
      'mem.guideLine1': 'Experience Capsules remember HOW to execute tasks; Memory Notes remember project rules, verified facts, decisions, and pitfalls.',
      'mem.guideLine2': 'Auto-captured before compaction, extracted on click ("Auto-Capture This Chat"), or pinned manually with tamper-evident hashing.',
      'mem.guideLine3': 'Active notes are injected automatically into future turns; click any pack card below to inspect every line or restore snapshots.',
      'mem.recapBadge': 'What I Just Remembered',
      'mem.viewDetail': 'View Details',
      'mem.sumHeadline': '{count} notes: {parts}',
      'mem.sumEmpty': 'Empty pack (click Auto-Capture or pin a note above)',

      'sec.constraints': 'Hard Rules',
      'sec.facts': 'Verified Facts',
      'sec.decisions': 'Decisions',
      'sec.pitfalls': 'Pitfalls & Fixes',
      'sec.workflows': 'Linked Routines',
      'sec.checkpoints': 'Next Steps',
      'secHint.constraints': 'Hard boundaries and rules AI must never violate',
      'secHint.facts': 'Verified file paths, commands, ports, and environment facts',
      'secHint.decisions': 'Agreed design choices and tradeoffs',
      'secHint.pitfalls': 'Past failures and verified workarounds to avoid repeating mistakes',
      'secHint.workflows': 'Related repeatable routines linked to this memory pack',
      'secHint.checkpoints': 'Open next steps and handoff status',

      'prio.critical': 'Critical',
      'prio.high': 'High',
      'prio.normal': 'Normal',

      'inj.title': 'Live Context Budget Sent to AI',
      'inj.empty': 'No active capsules or memory notes injected for this scope.',
      'inj.statChars': '{used} / {max} chars',
      'inj.statCaps': '{count} capsules',
      'inj.statPacks': '{count} memory packs',

      'port.capsuleExportTitle': 'Export Selected Capsule (.dshcapsule.json)',
      'port.copyCapsuleJson': 'Copy Capsule JSON',
      'port.exportTitle': 'Export Selected Memory Pack (.dshpack.json)',
      'port.copyJson': 'Copy Pack JSON',
      'port.importTitle': 'Import Shared Bundle',
      'port.importHint': 'Paste an exported .dshcapsule.json or .dshpack.json bundle below to verify and import.',
      'port.importPlaceholder': 'Paste exported JSON bundle here...',
      'port.importBtn': 'Verify & Import',

      'wf.titlePlaceholder': 'Workflow title (auto if blank)',
      'wf.distillBtn': 'Distill Current Chat',
      'wf.empty': 'No distilled workflows yet.',
      'wf.promoteBtn': 'Enable Skill',
      'wf.demoteBtn': 'Disable Skill',
      'wf.guardrailPlaceholder': 'Add guardrail rule & optimize...',
      'wf.optimizeBtn': 'Optimize',
      'wf.view.stages': 'Stages',
      'wf.view.skill': 'SKILL.md',
      'wf.view.script': 'PTC Script',

      'settings.title': 'Capsules & Memory (FlowPack)',
      'settings.loading': 'Loading FlowPack settings...',
      'settings.description': 'Configure how experience capsules crystallize, self-heal on errors, and protect long-term memory.',
      'settings.groupLearning': 'Learning & Self-Healing',
      'settings.groupSecurity': 'Memory Injection & Protection',
      'settings.strictMode': 'Strict provenance validation',
      'settings.strictModeHint': 'Ensure every saved note traces back to a verified session or explicit pin.',
      'settings.autoInject': 'Auto-inject active capsules & notes into every turn',
      'settings.autoInjectHint': 'Keeps selected capsules and project rules active across long conversations.',
      'settings.autoPackOnCompact': 'Auto-capture memory right before context compaction',
      'settings.autoPackHint': 'Prevents losing critical project context when DSH compacts history.',
      'settings.autoDistillOnIdle': 'Auto-draft workflow breakdown when idle',
      'settings.autoDistillHint': 'Maintains an inspectable workflow draft under More Tools -> Workflows.',
      'settings.requireSealed': 'Only inject verified sealed bundles',
      'settings.requireSealedHint': 'Automatically blocks tampered local files from entering prompts.',
      'settings.selfHeal': 'Runtime error self-healing hints',
      'settings.selfHealHint': 'Immediately suggests past working fixes whenever a tool fails.',
      'settings.autoConsolidate': 'Auto-reinforce active capsules on success',
      'settings.autoConsolidateHint': 'Strengthens capsule confidence and absorbs newly discovered fixes.',
      'settings.subagentInherit': 'Subagents inherit active capsules automatically',
      'settings.subagentInheritHint': 'Spawned agents immediately know the chosen workflow and fixes.',
      'settings.crystallizeThreshold': 'Successful runs to auto-crystallize',
      'settings.crystallizeThresholdHint': 'Repeats before a draft practice graduates into a full capsule button.',
      'settings.promptBudget': 'Max context budget (chars)',
      'settings.promptBudgetHint': 'Caps total characters injected per turn (default 3600).',
      'settings.redactSecrets': 'Secret / token protection',
      'settings.redactSecretsHint': 'Prevents API keys or tokens from leaking into portable capsules.',
      'settings.redactMask': 'Mask secrets automatically',
      'settings.redactReject': 'Reject if secret detected',
      'settings.redactOff': 'Disabled',
      'settings.storageDir': 'Storage directory',
      'settings.save': 'Save Settings',
      'settings.saved': 'Settings saved',

      'msg.noSessionOption': 'No chats available',
      'msg.unnamedSession': 'Current Chat',
      'msg.noSession': 'Open or select a valid chat first',
      'msg.distilled': 'Distilled "{name}" (score {score}/100)',
      'msg.optimized': 'Optimized to v{ver}',
      'msg.promoted': 'Enabled as runtime Skill',
      'msg.demoted': 'Disabled runtime Skill',
      'msg.deleted': 'Deleted',
      'msg.packed': 'Captured & protected "{title}"',
      'msg.pinned': 'Note saved & protected',
      'msg.sealed': 'Locked & verified',
      'msg.verified': 'Verified: {passed} OK, {failed} failed, {q} quarantined',
      'msg.rolledBack': 'Restored snapshot v{ver}',
      'msg.imported': 'Verified & imported "{title}"',
      'msg.inserted': 'Prompt placed into composer — ready to send!',
      'msg.copied': 'Copied to clipboard',
      'msg.copyFailed': 'Copy failed',
      'msg.capLearned': 'Saved experience "{title}" (attempt #{attempts})',
      'msg.capToggled': 'Scope updated: {scope}',
      'msg.capDisarmed': 'Capsule disabled',
      'msg.capCrystallized': 'Saved & enabled capsule button!',
      'msg.fixRecorded': 'Saved new fix (earlier generations remain intact)',
      'msg.genRestored': 'Restored Gen {gen} (newer versions still kept in history)',
      'msg.emptyName': 'Please enter a name first',
      'msg.renamed': 'Renamed to "{title}"',
      'msg.refreshedCap': 'Re-analyzed & updated "{title}"',

      'train.heroTitle': 'Show me once — AI watches, asks questions & practices until accepted',
      'train.heroDesc': 'Perform the workflow normally on your screen while AI captures steps and asks timely clarifying questions. Then let AI run practice rounds (using faster/better methods when available) while you coach and accept the final result into a reusable Capsule + Memory Pack.',
      'train.titlePh': 'Task name (optional — AI can auto-name it)',
      'train.goalPh': 'Expected deliverable or acceptance criteria (e.g. export clean xlsx with verified totals)',
      'train.autoQToggle': 'Let AI ask me in real time whenever a step looks ambiguous',
      'train.startWatchBtn': 'Start Watching My Screen (Live Demo)',
      'train.newManualBtn': 'New Blank Training Task',
      'train.unsupportedHint': 'Live desktop watcher is unavailable on this host; you can still add manual steps, ask AI, and run multi-round coaching.',
      'train.activeWatchBanner': 'Live watching in progress',
      'train.enterWatchBtn': 'Open Live Session',
      'train.listTitle': 'Apprenticeship & Training Sessions',
      'train.empty': 'No training sessions yet. Click "Start Watching My Screen" to demonstrate a task once and coach AI until it masters it.',
      'train.stepCount': '{count} demo steps',
      'train.roundCount': '{count} practice rounds',
      'train.pendingQBadge': '{count} question(s)',
      'train.betterFoundBadge': 'Better method found',
      'train.backToList': 'Back to Trainings',
      'train.renameBtn': 'Rename',
      'train.saveNameBtn': 'Save',
      'train.cancelBtn': 'Cancel',
      'train.deleteBtn': 'Delete',
      'train.status.watching': 'Watching Live',
      'train.status.ready': 'Ready to Train',
      'train.status.training': 'Training Rounds',
      'train.status.graduated': 'Graduated',
      'train.watchingStatus': 'Watching your actions ({count} steps captured · DSH & password fields excluded)',
      'train.captureNowBtn': 'Capture Frame',
      'train.aiAskBtn': 'Ask AI to Inspect',
      'train.finishDemoBtn': 'Done — Ready for AI Practice',
      'train.resumeWatchBtn': 'Resume Screen Watching',
      'train.aiReviewBtn': 'AI Review & Find Faster Way',
      'train.aiSummaryTitle': 'AI Understanding of Goal & Method',
      'train.aiNoSummaryYet': 'No summary yet — record a few steps, click Inspect, or launch Round 1.',
      'train.betterTitle': 'AI Found a Faster / Better Method',
      'train.questionsTitle': 'AI Real-Time Questions & Clarifications',
      'train.questionsEmpty': 'No pending questions right now. Ambiguous steps or Inspect triggers questions here.',
      'train.answerPh': 'Reply clearly — AI will remember this rule permanently…',
      'train.answerBtn': 'Answer & Remember',
      'train.skipQBtn': 'Skip',
      'train.answeredTag': 'Remembered answer',
      'train.skippedTag': 'Skipped',
      'train.stepsTitle': 'Human Demonstration Timeline ({count} steps)',
      'train.stepsEmpty': 'No demo steps recorded yet. Switch to your target app while watching, or add a manual step below.',
      'train.viewFrame': 'Frame',
      'train.hideFrame': 'Hide',
      'train.stepNotePh': 'Optional note or pitfall warning for this step…',
      'train.saveNoteBtn': 'Save Note',
      'train.addStepPh': 'Add a manual demo step (e.g. Export filtered sheet as CSV)…',
      'train.addStepBtn': 'Add Step',
      'train.roundsTitle': 'AI Practice Rounds & Your Coaching ({count} rounds)',
      'train.roundsHint': 'AI is encouraged to use faster/better alternatives (scripts, CLI, APIs) as long as the deliverables pass your acceptance check.',
      'train.coachPh': 'Write coaching feedback or requirements for this round (e.g. Skip manual clicking; parse via Python and verify totals)…',
      'train.startRoundBtn': 'Send Round {next} to AI',
      'train.syncRoundBtn': 'Record Round from Chat',
      'train.graduateDirectBtn': 'Graduate Directly to Capsule & Memory',
      'train.roundsEmpty': 'No practice rounds yet. Click Send Round 1 to drop the training brief into the chat composer.',
      'train.roundHeader': 'Round {no}',
      'train.methodBetter': 'AI Used Better Method',
      'train.methodDemo': 'Followed Demo Steps',
      'train.verdict.accepted': 'Accepted',
      'train.verdict.needs_fix': 'Needs Fix',
      'train.verdict.practice': 'Practice Again',
      'train.verdict.pending': 'Awaiting Review',
      'train.humanNotePrefix': 'Your note: ',
      'train.fixNextBtn': 'Flag Issue & Retry Next Round',
      'train.practiceMoreBtn': 'Good — Practice One More Round',
      'train.acceptAndGraduateBtn': 'Accept Result! Save Capsule & Memory',
      'train.graduatedTitle': 'Graduated! Saved as Reusable Capsule & Memory Pack',
      'train.graduatedDesc': 'Gen 1 preserves your human demonstration baseline while Gen 2 locks in AI’s accepted method plus all clarifications and coaching fixes across future chats and subagents.',
      'train.openCapsuleBtn': 'Open Experience Capsule',
      'train.openMemoryBtn': 'Open Memory Pack',

      'msg.trainWatching': 'Live screen watching started — perform your task normally (DSH & passwords ignored)',
      'msg.trainCreated': 'Training task created',
      'msg.trainWatchFallback': 'Live watcher fallback ({warn}); manual & AI coaching remain ready',
      'msg.trainCaptured': 'Captured current frame & window context',
      'msg.trainQuestionRaised': 'Captured step and AI raised a question for you!',
      'msg.trainStopped': 'Stopped live watching — ready for AI practice rounds',
      'msg.trainStepAdded': 'Demo step added',
      'msg.trainNoteSaved': 'Saved step annotation',
      'msg.trainAiReviewed': 'AI inspected the demonstration',
      'msg.trainAiReviewUnavailable': 'Vision LLM unavailable right now; heuristic summary retained',
      'msg.trainQuestionAnswered': 'Clarification saved for AI!',
      'msg.trainQuestionSkipped': 'Question skipped',
      'msg.trainRoundPrepared': 'Round {no} prompt placed into composer — hit send to start practice!',
      'msg.trainRoundRecorded': 'Captured current chat attempt as a practice round',
      'msg.trainNextRoundReady': 'Coaching saved and next round prompt placed into composer!',
      'msg.trainAnnotated': 'Round feedback saved',
      'msg.trainGraduated': '"{title}" graduated into an Experience Capsule + sealed Memory Pack!',
    }

    /* ─────────────────────────── polished DSH native styles ─────────────────────────── */

    const CSS = `
.dfp-theme,
.dfp-dock {
  --dfp-bg: var(--dsw-alias-bg-base, #f6f8fc);
  --dfp-surface: var(--dsw-alias-bg-layer-1, #ffffff);
  --dfp-surface-2: var(--dsw-alias-bg-layer-2, #eef2f8);
  --dfp-border: var(--dsw-alias-border-l3, rgba(15, 23, 42, 0.11));
  --dfp-text: var(--dsw-alias-label-primary, #101828);
  --dfp-text-2: var(--dsw-alias-label-secondary, #475467);
  --dfp-text-3: var(--dsw-alias-label-tertiary, #7b8798);
  --dfp-hover: var(--dsw-alias-interactive-bg-hover, rgba(15, 23, 42, 0.05));
  --dfp-accent: var(--dsw-alias-state-business-primary, #2563eb);
  --dfp-accent-soft: rgba(37, 99, 235, 0.1);
  --dfp-accent-fg: #ffffff;
  --dfp-ok: #12b76a;
  --dfp-ok-soft: rgba(18, 183, 106, 0.12);
  --dfp-warn: #f79009;
  --dfp-warn-soft: rgba(247, 144, 9, 0.13);
  --dfp-err: var(--dsw-alias-state-error-primary, #d92d20);
  --dfp-err-soft: rgba(217, 45, 32, 0.1);
  color: var(--dfp-text);
}
.dfp-theme[data-dfp-scheme="dark"],
body[data-ds-dark-theme] .dfp-theme,
body[data-ds-dark-theme] .dfp-dock,
html.dark .dfp-theme,
html.dark .dfp-dock,
html[data-dfl-theme="dark"] .dfp-theme,
html[data-dfl-theme="dark"] .dfp-dock {
  --dfp-bg: var(--dsw-alias-bg-base, #0d1117);
  --dfp-surface: var(--dsw-alias-bg-layer-1, #151b24);
  --dfp-surface-2: var(--dsw-alias-bg-layer-2, #1d2633);
  --dfp-border: var(--dsw-alias-border-l3, rgba(255, 255, 255, 0.11));
  --dfp-text: var(--dsw-alias-label-primary, #e8eef7);
  --dfp-text-2: var(--dsw-alias-label-secondary, #adb8c8);
  --dfp-text-3: var(--dsw-alias-label-tertiary, #7f8c9f);
  --dfp-hover: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.065));
  --dfp-accent: var(--dsw-alias-state-business-primary, #60a5fa);
  --dfp-accent-soft: rgba(96, 165, 250, 0.15);
  --dfp-accent-fg: #081221;
  --dfp-ok: #34d399;
  --dfp-ok-soft: rgba(52, 211, 153, 0.14);
  --dfp-warn: #fbbf24;
  --dfp-warn-soft: rgba(251, 191, 36, 0.15);
  --dfp-err: var(--dsw-alias-state-error-primary, #f97066);
  --dfp-err-soft: rgba(249, 112, 102, 0.14);
}
.dfp-body::-webkit-scrollbar, .dfp-pre::-webkit-scrollbar, .dfp-overlay-card::-webkit-scrollbar { width: 6px; height: 6px; }
.dfp-body::-webkit-scrollbar-thumb, .dfp-pre::-webkit-scrollbar-thumb, .dfp-overlay-card::-webkit-scrollbar-thumb {
  background: var(--dfp-border); border-radius: 999px;
}
.dfp-root {
  display: flex; flex-direction: column; height: 100%; min-height: 0;
  background: var(--dfp-bg); color: var(--dfp-text); font-size: 12px; line-height: 1.5;
}
.dfp-header {
  padding: 12px 14px 10px; border-bottom: 0.5px solid var(--dfp-border);
  background: var(--dfp-bg); flex: none; display: flex; flex-direction: column; gap: 9px;
}
.dfp-header-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dfp-brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dfp-brand-mark {
  width: 26px; height: 26px; border-radius: 8px; flex: none;
  display: grid; place-items: center;
  background: var(--dfp-accent-soft); color: var(--dfp-accent);
}
.dfp-brand-text { display: flex; align-items: center; gap: 7px; min-width: 0; }
.dfp-title { font-weight: 600; font-size: 13.5px; letter-spacing: -0.01em; }
.dfp-brand-pill {
  font-size: 10.5px; font-weight: 500; padding: 1px 7px; border-radius: 999px;
  background: var(--dfp-ok-soft); color: var(--dfp-ok); white-space: nowrap;
}
.dfp-header-actions { display: flex; align-items: center; gap: 4px; }
.dfp-icon-btn {
  width: 28px; height: 28px; padding: 0; border: 0; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; color: var(--dfp-text-2); cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.dfp-icon-btn:hover:not(:disabled) { background: var(--dfp-hover); color: var(--dfp-text); }
.dfp-icon-btn:disabled { opacity: 0.4; cursor: default; }

.dfp-context-bar {
  display: flex; align-items: center; gap: 6px; padding: 4px 8px;
  border-radius: 8px; background: var(--dfp-surface); border: 0.5px solid var(--dfp-border);
}
.dfp-context-label { font-size: 11px; color: var(--dfp-text-3); flex: none; }
.dfp-context-select {
  flex: 1; min-width: 0; border: 0; background: transparent; color: var(--dfp-text);
  font: inherit; font-size: 11.5px; font-weight: 500; outline: none; cursor: pointer;
}
.dfp-context-select option { background: var(--dfp-surface); color: var(--dfp-text); }
.dfp-context-ws {
  flex: none; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 10.5px; padding: 1px 6px; border-radius: 6px;
  background: var(--dfp-surface-2); color: var(--dfp-text-2);
}

.dfp-seg-tabs {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px;
  padding: 3px; border-radius: 10px; background: var(--dfp-surface-2);
}
.dfp-seg-tab {
  height: 28px; border: 0; border-radius: 7.5px; background: transparent;
  color: var(--dfp-text-2); font: inherit; font-size: 12px; font-weight: 500;
  cursor: pointer; transition: all 140ms ease;
}
.dfp-seg-tab:hover { color: var(--dfp-text); }
.dfp-seg-tab.is-active {
  background: var(--dfp-surface); color: var(--dfp-text);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.dfp-toast {
  margin: 10px 14px 0; padding: 8px 12px; border-radius: 9px; font-size: 11.5px; font-weight: 500;
  background: var(--dfp-accent); color: var(--dfp-accent-fg); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}
.dfp-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px 18px; }
.dfp-stack { display: flex; flex-direction: column; gap: 10px; }
.dfp-list { display: flex; flex-direction: column; gap: 7px; }
.dfp-section-label { font-size: 11px; font-weight: 600; color: var(--dfp-text-3); padding: 2px 2px 0; }

.dfp-active-banner {
  padding: 10px 12px; border-radius: 11px;
  background: var(--dfp-ok-soft); border: 0.5px solid rgba(18, 183, 106, 0.28);
}
.dfp-active-banner-head { display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 500; color: var(--dfp-text); }
.dfp-active-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--dfp-ok); flex: none; }
.dfp-active-title { flex: 1; min-width: 0; }
.dfp-chip-wrap { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.dfp-armed-chip {
  display: inline-flex; align-items: center; border-radius: 999px;
  background: var(--dfp-surface); border: 0.5px solid var(--dfp-border); overflow: hidden;
}
.dfp-armed-chip-main {
  display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 8px 0 9px;
  border: 0; background: transparent; color: var(--dfp-text); font: inherit; font-size: 11.5px; font-weight: 500; cursor: pointer;
}
.dfp-armed-chip-main:hover { background: var(--dfp-hover); }
.dfp-armed-scope { font-size: 10px; color: var(--dfp-text-3); }
.dfp-armed-chip-x {
  width: 20px; height: 24px; border: 0; background: transparent; color: var(--dfp-text-3);
  cursor: pointer; font-size: 13px; line-height: 1;
}
.dfp-armed-chip-x:hover { color: var(--dfp-err); background: var(--dfp-err-soft); }

.dfp-hero-card, .dfp-detail-card, .dfp-capture-strip {
  background: var(--dfp-surface); border: 0.5px solid var(--dfp-border);
  border-radius: 12px; padding: 11px 13px;
}
.dfp-recap-card {
  background: linear-gradient(180deg, var(--dfp-accent-soft), var(--dfp-surface) 38%);
  border: 0.5px solid rgba(36, 107, 253, 0.35);
  border-radius: 12px; padding: 11px 13px;
}
.dfp-recap-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dfp-recap-badge {
  font-size: 10.5px; font-weight: 600; padding: 2px 8px; border-radius: 999px;
  background: var(--dfp-accent); color: var(--dfp-accent-fg);
}
.dfp-recap-name { font-size: 13.5px; font-weight: 600; color: var(--dfp-text); word-break: break-word; }
.dfp-recap-kv { font-size: 11.5px; line-height: 1.5; color: var(--dfp-text-2); }
.dfp-recap-k { font-weight: 600; color: var(--dfp-text); }
.dfp-recap-steps { display: flex; flex-direction: column; gap: 5px; }
.dfp-recap-step-row {
  display: flex; align-items: flex-start; gap: 7px; padding: 5px 8px;
  border-radius: 8px; background: var(--dfp-bg); font-size: 11.5px; line-height: 1.45;
}
.dfp-recap-step-text { min-width: 0; color: var(--dfp-text); word-break: break-word; }
.dfp-recap-step-sub { color: var(--dfp-text-2); }
.dfp-recap-summary {
  padding: 9px 10px; border-radius: 9px; background: var(--dfp-bg); border: 0.5px solid var(--dfp-border);
}
.dfp-recap-summary-head {
  display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap;
  font-size: 11.5px; font-weight: 600; color: var(--dfp-text);
}
.dfp-detail-nav {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;
}
.dfp-back-btn {
  display: inline-flex; align-items: center; gap: 4px; height: 27px; padding: 0 9px;
  border-radius: 8px; border: 0.5px solid var(--dfp-border); background: var(--dfp-surface);
  color: var(--dfp-text); font: inherit; font-size: 11.5px; font-weight: 500; cursor: pointer;
}
.dfp-back-btn:hover { background: var(--dfp-hover); }
.dfp-cap-toggle {
  height: 20px; padding: 0 7px; border-radius: 999px; border: 0.5px solid var(--dfp-border);
  background: var(--dfp-surface-2); color: var(--dfp-text-2); font: inherit; font-size: 10px; font-weight: 500;
  cursor: pointer; white-space: nowrap; flex: none;
}
.dfp-cap-toggle:hover { border-color: var(--dfp-accent); color: var(--dfp-text); }
.dfp-cap-toggle.is-on {
  border-color: rgba(18, 183, 106, 0.45); background: var(--dfp-ok-soft); color: var(--dfp-ok); font-weight: 600;
}
.dfp-cap-headline {
  margin-top: 5px; font-size: 11.5px; color: var(--dfp-text-2); line-height: 1.45;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.dfp-cap-footer-row {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-top: 7px;
}
.dfp-cap-footer-row .dfp-meter-wrap { margin-top: 0; }
.dfp-cap-footer-row .dfp-cap-stats { margin-top: 0; }
.dfp-raw-wrap {
  max-height: 210px; overflow-y: auto; padding: 7px 9px; border-radius: 8px;
  background: var(--dfp-bg); border: 0.5px solid var(--dfp-border);
  display: flex; flex-direction: column; gap: 4px;
}
.dfp-raw-row { display: flex; align-items: baseline; gap: 5px; font-size: 10.5px; color: var(--dfp-text-2); }
.dfp-raw-idx { color: var(--dfp-text-3); flex: none; font-variant-numeric: tabular-nums; }
.dfp-raw-phase { font-weight: 600; color: var(--dfp-text); flex: none; }
.dfp-raw-tools { min-width: 0; word-break: break-word; }
.dfp-hero-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dfp-card-eyebrow { display: inline-flex; align-items: center; gap: 5px; font-weight: 600; font-size: 12.5px; color: var(--dfp-text); }
.dfp-card-sub { margin: 4px 0 0; font-size: 11.5px; color: var(--dfp-text-2); line-height: 1.45; }
.dfp-link-btn {
  border: 0; background: transparent; color: var(--dfp-accent); font: inherit; font-size: 11px; font-weight: 500;
  cursor: pointer; padding: 2px 4px; border-radius: 5px; white-space: nowrap;
}
.dfp-link-btn:hover { background: var(--dfp-accent-soft); }

.dfp-row { display: flex; align-items: center; gap: 7px; }
.dfp-mt4 { margin-top: 4px; }
.dfp-mt6 { margin-top: 6px; }
.dfp-mt8 { margin-top: 8px; }
.dfp-mt10 { margin-top: 10px; }
.dfp-mt12 { margin-top: 12px; }
.dfp-mb8 { margin-bottom: 8px; }

.dfp-input, .dfp-select-sm, .dfp-textarea {
  width: 100%; box-sizing: border-box;
  border: 0.5px solid var(--dfp-border); border-radius: 8px;
  background: var(--dfp-bg); color: var(--dfp-text);
  padding: 6px 9px; font: inherit; font-size: 12px; outline: none;
  transition: border-color 120ms ease;
}
.dfp-input:focus, .dfp-select-sm:focus, .dfp-textarea:focus { border-color: var(--dfp-accent); }
.dfp-select-sm { width: auto; flex: 1; cursor: pointer; }
.dfp-input-sm { width: 104px; flex: none; }
.dfp-textarea { min-height: 112px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; line-height: 1.45; }

.dfp-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  height: 30px; padding: 0 11px; border-radius: 8px; border: 0.5px solid transparent;
  font: inherit; font-size: 11.5px; font-weight: 500; cursor: pointer; white-space: nowrap;
  transition: opacity 120ms ease, background 120ms ease;
}
.dfp-btn:disabled { opacity: 0.45; cursor: default; }
.dfp-btn-flex { flex: 1; }
.dfp-btn-full { width: 100%; }
.dfp-btn-sm { height: 27px; padding: 0 9px; font-size: 11px; border-radius: 7px; }
.dfp-btn-xs { height: 23px; padding: 0 8px; font-size: 10.5px; border-radius: 6px; }
.dfp-btn-primary { background: var(--dfp-accent); color: var(--dfp-accent-fg); }
.dfp-btn-primary:hover:not(:disabled) { opacity: 0.92; }
.dfp-btn-soft { background: var(--dfp-surface-2); color: var(--dfp-text); border-color: var(--dfp-border); }
.dfp-btn-soft:hover:not(:disabled) { background: var(--dfp-hover); }
.dfp-btn-danger-ghost { background: transparent; color: var(--dfp-err); }
.dfp-btn-danger-ghost:hover:not(:disabled) { background: var(--dfp-err-soft); }
.dfp-btn-group { display: flex; align-items: center; gap: 5px; flex: none; }

.dfp-empty-card {
  padding: 20px 16px; border-radius: 12px; text-align: center;
  background: var(--dfp-surface); border: 1px dashed var(--dfp-border);
}
.dfp-empty-icon {
  width: 40px; height: 40px; margin: 0 auto 8px; border-radius: 11px;
  display: grid; place-items: center; background: var(--dfp-accent-soft); color: var(--dfp-accent);
}
.dfp-empty-heading { font-weight: 600; font-size: 13px; color: var(--dfp-text); }
.dfp-empty-desc { margin: 5px auto 0; max-width: 340px; font-size: 11.5px; color: var(--dfp-text-2); line-height: 1.5; }
.dfp-onboard-steps { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; text-align: left; }
.dfp-onboard-step {
  display: flex; align-items: center; gap: 8px; padding: 6px 9px; border-radius: 8px;
  background: var(--dfp-bg); font-size: 11.5px; color: var(--dfp-text-2);
}
.dfp-step-num {
  width: 18px; height: 18px; border-radius: 999px; flex: none;
  display: grid; place-items: center; font-size: 10.5px; font-weight: 600;
  background: var(--dfp-accent-soft); color: var(--dfp-accent);
}

.dfp-cap-card {
  background: var(--dfp-surface); border: 0.5px solid var(--dfp-border);
  border-radius: 11px; padding: 10px 12px; cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease;
}
.dfp-cap-card:hover { background: var(--dfp-hover); }
.dfp-cap-card.is-selected { border-color: var(--dfp-accent); box-shadow: 0 0 0 1px var(--dfp-accent-soft); }
.dfp-cap-card.is-mounted { border-color: rgba(18, 183, 106, 0.45); }
.dfp-cap-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.dfp-cap-info { min-width: 0; flex: 1; }
.dfp-cap-title-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dfp-cap-title { font-weight: 600; font-size: 12.5px; color: var(--dfp-text); word-break: break-word; }
.dfp-live-tag {
  font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 999px;
  background: var(--dfp-ok-soft); color: var(--dfp-ok);
}
.dfp-meter-wrap { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
.dfp-meter-dots { display: flex; gap: 3px; }
.dfp-meter-dot { width: 12px; height: 4px; border-radius: 999px; background: var(--dfp-surface-2); }
.dfp-meter-dot.is-filled { background: var(--dfp-warn); }
.dfp-meter-dot.is-cryst { background: var(--dfp-ok); }
.dfp-meter-label { font-size: 10.5px; color: var(--dfp-text-3); font-weight: 500; }
.dfp-meter-label.is-cryst { color: var(--dfp-ok); }
.dfp-cap-stats { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; margin-top: 7px; font-size: 11px; color: var(--dfp-text-3); }
.dfp-dot-sep { opacity: 0.45; }

.dfp-detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.dfp-detail-title { font-weight: 600; font-size: 13px; color: var(--dfp-text); word-break: break-word; }
.dfp-detail-sub { font-size: 11.5px; color: var(--dfp-text-2); margin-top: 2px; word-break: break-word; }

.dfp-scope-box { margin-top: 10px; padding: 9px 10px; border-radius: 9px; background: var(--dfp-bg); border: 0.5px solid var(--dfp-border); }
.dfp-scope-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 7px; }
.dfp-field-label { font-size: 11px; font-weight: 600; color: var(--dfp-text-2); }
.dfp-inherit-note { font-size: 10px; color: var(--dfp-accent); font-weight: 500; }
.dfp-scope-pills { display: flex; flex-wrap: wrap; gap: 5px; }
.dfp-scope-pill {
  height: 25px; padding: 0 9px; border-radius: 999px; border: 0.5px solid var(--dfp-border);
  background: var(--dfp-surface); color: var(--dfp-text-2); font: inherit; font-size: 11px; cursor: pointer;
}
.dfp-scope-pill:hover { background: var(--dfp-hover); color: var(--dfp-text); }
.dfp-scope-pill.is-on { background: var(--dfp-accent-soft); border-color: var(--dfp-accent); color: var(--dfp-accent); font-weight: 600; }

.dfp-subtabs { display: flex; gap: 4px; border-bottom: 0.5px solid var(--dfp-border); padding-bottom: 7px; }
.dfp-subtab {
  height: 25px; padding: 0 10px; border: 0; border-radius: 7px; background: transparent;
  color: var(--dfp-text-2); font: inherit; font-size: 11.5px; font-weight: 500; cursor: pointer;
}
.dfp-subtab:hover { background: var(--dfp-hover); color: var(--dfp-text); }
.dfp-subtab.is-active { background: var(--dfp-accent-soft); color: var(--dfp-accent); font-weight: 600; }

.dfp-subview { margin-top: 10px; }
.dfp-sub-head-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.dfp-sub-heading { display: flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 600; color: var(--dfp-text-2); margin-bottom: 6px; }
.dfp-sub-head-row .dfp-sub-heading { margin-bottom: 0; }

.dfp-timeline { display: flex; flex-direction: column; gap: 8px; }
.dfp-timeline-item { display: flex; gap: 8px; align-items: flex-start; }
.dfp-timeline-rail { padding-top: 2px; flex: none; }
.dfp-timeline-num {
  width: 19px; height: 19px; border-radius: 999px; display: grid; place-items: center;
  font-size: 10.5px; font-weight: 600; background: var(--dfp-surface-2); color: var(--dfp-text-2);
}
.dfp-timeline-body {
  flex: 1; min-width: 0; padding: 7px 9px; border-radius: 8px;
  background: var(--dfp-bg); border: 0.5px solid var(--dfp-border);
}
.dfp-timeline-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.dfp-timeline-phase { font-size: 11.5px; font-weight: 600; color: var(--dfp-text); }
.dfp-tag-parallel {
  font-size: 10px; padding: 1px 6px; border-radius: 999px;
  background: var(--dfp-accent-soft); color: var(--dfp-accent); font-weight: 500;
}
.dfp-step-desc { font-size: 11px; color: var(--dfp-text-2); margin-top: 4px; word-break: break-word; }
.dfp-tool-tag {
  display: inline-block; padding: 0 5px; border-radius: 4px;
  background: var(--dfp-surface-2); color: var(--dfp-text);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10.5px;
}

.dfp-gen-list { display: flex; flex-direction: column; gap: 6px; }
.dfp-gen-card {
  padding: 8px 10px; border-radius: 8px; background: var(--dfp-bg); border: 0.5px solid var(--dfp-border);
}
.dfp-gen-card.is-current { border-color: var(--dfp-accent); }
.dfp-gen-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dfp-gen-title { display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; color: var(--dfp-text); flex-wrap: wrap; }
.dfp-gen-badge {
  font-size: 10px; font-weight: 500; padding: 1px 6px; border-radius: 999px;
  background: var(--dfp-surface-2); color: var(--dfp-text-2);
}
.dfp-gen-meta { font-size: 10.5px; color: var(--dfp-text-3); margin-top: 3px; }
.dfp-gen-reason { font-size: 11px; color: var(--dfp-text-2); margin-top: 2px; }

.dfp-heal-list { display: flex; flex-direction: column; gap: 7px; }
.dfp-heal-card { padding: 9px 10px; border-radius: 9px; background: var(--dfp-bg); border: 0.5px solid var(--dfp-border); }
.dfp-heal-problem, .dfp-heal-fix { display: flex; align-items: baseline; gap: 6px; font-size: 11.5px; word-break: break-word; }
.dfp-heal-fix { margin-top: 5px; color: var(--dfp-text); }
.dfp-heal-tag { flex: none; font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 5px; }
.dfp-heal-tag.is-err { background: var(--dfp-err-soft); color: var(--dfp-err); }
.dfp-heal-tag.is-fix { background: var(--dfp-ok-soft); color: var(--dfp-ok); }
.dfp-heal-fallback { font-size: 10.5px; color: var(--dfp-text-3); margin-top: 5px; }
.dfp-heal-log { font-size: 11px; color: var(--dfp-text-2); padding: 3px 0; border-bottom: 0.5px dashed var(--dfp-border); }

.dfp-soft-box, .dfp-muted-box {
  padding: 9px 10px; border-radius: 9px; background: var(--dfp-bg); border: 0.5px solid var(--dfp-border);
  font-size: 11.5px; color: var(--dfp-text-2);
}
.dfp-plugin-pills { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px; }
.dfp-plugin-pill {
  display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px;
  background: var(--dfp-surface); border: 0.5px solid var(--dfp-border); font-size: 11px; color: var(--dfp-text-2);
}
.dfp-plugin-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--dfp-ok); }

.dfp-format-grid { display: flex; flex-wrap: wrap; gap: 5px; }
.dfp-format-btn {
  height: 25px; padding: 0 9px; border-radius: 7px; border: 0.5px solid var(--dfp-border);
  background: var(--dfp-bg); color: var(--dfp-text-2); font: inherit; font-size: 11px; cursor: pointer;
}
.dfp-format-btn.is-active { background: var(--dfp-accent-soft); border-color: var(--dfp-accent); color: var(--dfp-accent); font-weight: 600; }
.dfp-pre {
  margin: 0; padding: 9px 10px; border-radius: 8px; background: var(--dfp-bg); border: 0.5px solid var(--dfp-border);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; line-height: 1.48;
  white-space: pre-wrap; word-break: break-word; max-height: 260px; overflow-y: auto; color: var(--dfp-text);
}

.dfp-seal-badge {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px;
  font-size: 10.5px; font-weight: 500; background: var(--dfp-surface-2); color: var(--dfp-text-2); white-space: nowrap;
}
.dfp-seal-badge.is-ok { background: var(--dfp-ok-soft); color: var(--dfp-ok); }
.dfp-seal-badge.is-warn { background: var(--dfp-warn-soft); color: var(--dfp-warn); }
.dfp-note-group { margin-top: 10px; padding-top: 8px; border-top: 0.5px solid var(--dfp-border); }
.dfp-note-group-head { font-size: 11px; font-weight: 600; color: var(--dfp-text-2); margin-bottom: 5px; }
.dfp-note-row { display: flex; align-items: flex-start; gap: 7px; padding: 3px 0; font-size: 11.5px; color: var(--dfp-text); }
.dfp-prio-dot { width: 7px; height: 7px; border-radius: 999px; margin-top: 5px; flex: none; }
.dfp-prio-dot.is-critical { background: var(--dfp-err); }
.dfp-prio-dot.is-high { background: var(--dfp-warn); }
.dfp-prio-dot.is-normal { background: var(--dfp-text-3); }
.dfp-note-text { min-width: 0; word-break: break-word; }
.dfp-note-hint { font-size: 10.5px; color: var(--dfp-text-3); margin-bottom: 4px; line-height: 1.35; }
.dfp-mem-explainer {
  padding: 10px 12px; border-radius: 11px; border: 0.5px solid var(--dfp-border);
  background: var(--dfp-surface-2);
}
.dfp-mem-bullets {
  display: flex; flex-direction: column; gap: 4px;
  font-size: 11px; color: var(--dfp-text-2); line-height: 1.5;
}
.dfp-cap-subtitle { font-size: 11px; color: var(--dfp-text-2); line-height: 1.4; }
.dfp-cap-preview-list {
  display: flex; flex-direction: column; gap: 3px;
  padding: 6px 8px; border-radius: 8px; background: var(--dfp-bg); border: 0.5px solid var(--dfp-border);
}
.dfp-cap-preview-item {
  font-size: 11px; color: var(--dfp-text-2); line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden;
}

.dfp-alert {
  padding: 9px 11px; border-radius: 9px; border: 0.5px solid var(--dfp-err);
  background: var(--dfp-err-soft); color: var(--dfp-text); font-size: 11.5px;
}
.dfp-progress { height: 7px; border-radius: 999px; background: var(--dfp-surface-2); overflow: hidden; }
.dfp-progress-bar { height: 100%; border-radius: 999px; background: var(--dfp-accent); transition: width 200ms ease; }
.dfp-muted { font-size: 11px; color: var(--dfp-text-3); }

/* Title chip, Header & Composer slots */
.dfp-title-chip { display: inline-flex; align-items: center; gap: 6px; }
.dfp-header-entry, .dfp-composer-entry {
  display: inline-flex; align-items: center; gap: 5px; border: 0; background: transparent;
  color: inherit; cursor: pointer; border-radius: 7px; padding: 4px 7px; font: inherit; font-size: 12px;
}
.dfp-header-entry:hover, .dfp-composer-entry:hover { background: var(--dsw-alias-interactive-bg-hover); }

/* Dock & Hero pills */
.dfp-dock { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 2px 4px; }
.dfp-dock-trigger, .dfp-dock-pill, .dfp-hero-pill {
  display: inline-flex; align-items: center; gap: 5px; height: 25px; padding: 0 10px;
  border-radius: 999px; border: 0.5px solid var(--dfp-border);
  background: var(--dfp-surface); color: var(--dfp-text-2);
  font: inherit; font-size: 11.5px; font-weight: 500; cursor: pointer; white-space: nowrap;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.dfp-dock-pill { max-width: 165px; overflow: hidden; }
.dfp-dock-pill-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dfp-dock-dot { flex: none; }
.dfp-dock-trigger:hover, .dfp-dock-pill:hover, .dfp-hero-pill:hover {
  background: var(--dfp-hover); color: var(--dfp-text); border-color: var(--dfp-accent);
}
.dfp-dock-trigger.is-armed, .dfp-dock-pill.is-on, .dfp-hero-pill.is-armed {
  border-color: rgba(18, 183, 106, 0.45); background: var(--dfp-ok-soft); color: var(--dfp-ok);
}
.dfp-dock-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--dfp-ok); }

/* Floating Overlay Picker */
.dfp-overlay-backdrop {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(8, 12, 20, 0.48); backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center; padding: 18px;
}
.dfp-overlay-card {
  width: min(540px, 94vw); max-height: 82vh; overflow-y: auto;
  background: var(--dfp-surface); color: var(--dfp-text);
  border: 0.5px solid var(--dfp-border); border-radius: 15px;
  padding: 18px 20px; box-shadow: 0 22px 60px rgba(0, 0, 0, 0.3);
}
.dfp-overlay-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.dfp-overlay-title { display: flex; align-items: center; gap: 7px; font-weight: 600; font-size: 15px; color: var(--dfp-text); }
.dfp-overlay-toolbar { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.dfp-scope-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.dfp-overlay-list { display: flex; flex-direction: column; gap: 8px; }

/* Settings page */
.dfp-settings { max-width: 720px; display: flex; flex-direction: column; gap: 12px; font-size: 12.5px; }
.dfp-set-head h2 { margin: 0 0 3px; font-size: 16px; color: var(--dfp-text); }
.dfp-set-head p { margin: 0; font-size: 12px; color: var(--dfp-text-3); }
.dfp-set-card {
  background: var(--dfp-surface); border: 0.5px solid var(--dfp-border);
  border-radius: 12px; padding: 12px 15px;
}
.dfp-set-card h3 { margin: 0 0 8px; font-size: 12px; font-weight: 600; color: var(--dfp-text-2); }
.dfp-set-row {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 7px 0; border-bottom: 0.5px solid var(--dfp-border);
}
.dfp-set-row:last-child { border-bottom: 0; }
.dfp-set-text { display: flex; flex-direction: column; gap: 1px; }
.dfp-set-title { font-size: 12.5px; color: var(--dfp-text); }
.dfp-set-hint { font-size: 11px; color: var(--dfp-text-3); }
.dfp-set-row input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--dfp-accent); cursor: pointer; }
.dfp-set-path { font-size: 11px; color: var(--dfp-text-3); word-break: break-all; padding: 0 2px; }
.dfp-set-footer { display: flex; align-items: center; justify-content: flex-end; gap: 12px; }
.dfp-settings-loading { padding: 16px; color: var(--dfp-text-3); }

/* Watch & Train tab */
.dfp-seg-tab { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 5px; }
.dfp-tr-tab-dot { width: 6px; height: 6px; border-radius: 999px; flex: none; }
.dfp-tr-tab-dot.is-live { background: #ef4444; animation: dfpPulse 1.4s ease-in-out infinite; }
.dfp-tr-tab-dot.is-ask { background: var(--dfp-warn); }
@keyframes dfpPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.45; transform: scale(0.8); } }

.dfp-tr-hero {
  background: linear-gradient(145deg, var(--dfp-accent-soft), var(--dfp-surface));
  border: 0.5px solid var(--dfp-border); border-radius: 12px; padding: 12px 13px;
  display: flex; flex-direction: column; gap: 8px;
}
.dfp-tr-hero-title { font-size: 13.5px; font-weight: 650; color: var(--dfp-text); }
.dfp-tr-hero-desc { font-size: 11.5px; color: var(--dfp-text-2); line-height: 1.5; }
.dfp-tr-warn-box {
  padding: 7px 10px; border-radius: 8px; font-size: 11px;
  background: var(--dfp-warn-soft); color: var(--dfp-warn); border: 0.5px solid rgba(247, 144, 9, 0.35);
}
.dfp-tr-watch-bar {
  padding: 9px 11px; border-radius: 10px;
  background: rgba(239, 68, 68, 0.09); border: 0.5px solid rgba(239, 68, 68, 0.35);
  display: flex; flex-direction: column; gap: 7px;
}
.dfp-tr-watch-info { display: flex; align-items: center; gap: 7px; font-size: 11.5px; font-weight: 500; color: var(--dfp-text); }
.dfp-tr-pulse {
  width: 8px; height: 8px; border-radius: 999px; background: #ef4444; flex: none;
  animation: dfpPulse 1.3s ease-in-out infinite;
}
.dfp-tr-card {
  background: var(--dfp-surface); border: 0.5px solid var(--dfp-border);
  border-radius: 11px; padding: 11px 12px; display: flex; flex-direction: column; gap: 6px;
}
.dfp-tr-card.is-clickable { cursor: pointer; transition: border-color 120ms ease, background 120ms ease; }
.dfp-tr-card.is-clickable:hover { border-color: var(--dfp-accent); background: var(--dfp-hover); }
.dfp-tr-card-head { display: flex; align-items: center; gap: 7px; min-width: 0; }
.dfp-tr-card-title { font-size: 12.5px; font-weight: 600; color: var(--dfp-text); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dfp-tr-subhead { font-size: 12px; font-weight: 600; color: var(--dfp-text); display: flex; align-items: center; }
.dfp-tr-body-text { font-size: 11.5px; color: var(--dfp-text-2); line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.dfp-tr-muted { font-size: 11px; color: var(--dfp-text-3); line-height: 1.45; }
.dfp-tr-clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.dfp-tr-empty {
  padding: 20px 14px; text-align: center; font-size: 11.5px; color: var(--dfp-text-3);
  border: 0.5px dashed var(--dfp-border); border-radius: 11px; background: var(--dfp-surface);
}
.dfp-tr-badge {
  font-size: 10.5px; font-weight: 500; padding: 1px 7px; border-radius: 999px; white-space: nowrap;
  background: var(--dfp-surface-2); color: var(--dfp-text-2);
}
.dfp-tr-badge.is-watching { background: rgba(239, 68, 68, 0.14); color: #ef4444; }
.dfp-tr-badge.is-training { background: var(--dfp-accent-soft); color: var(--dfp-accent); }
.dfp-tr-badge.is-graduated { background: var(--dfp-ok-soft); color: var(--dfp-ok); }
.dfp-tr-meta-row { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; }
.dfp-tr-pill {
  font-size: 10.5px; padding: 1px 7px; border-radius: 999px;
  background: var(--dfp-surface-2); color: var(--dfp-text-2); border: 0.5px solid var(--dfp-border);
}
.dfp-tr-pill.is-warn { background: var(--dfp-warn-soft); color: var(--dfp-warn); border-color: rgba(247, 144, 9, 0.35); }
.dfp-tr-pill.is-ok { background: var(--dfp-ok-soft); color: var(--dfp-ok); border-color: rgba(18, 183, 106, 0.35); }

.dfp-tr-nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dfp-tr-nav-actions { display: flex; align-items: center; gap: 5px; }
.dfp-tr-back {
  border: 0; background: transparent; color: var(--dfp-accent); font: inherit; font-size: 12px;
  font-weight: 500; cursor: pointer; padding: 3px 4px; border-radius: 6px;
}
.dfp-tr-back:hover { background: var(--dfp-accent-soft); }

.dfp-tr-input, .dfp-tr-textarea {
  width: 100%; box-sizing: border-box; border-radius: 8px; border: 0.5px solid var(--dfp-border);
  background: var(--dfp-bg); color: var(--dfp-text); font: inherit; font-size: 11.5px;
  padding: 6px 9px; outline: none;
}
.dfp-tr-input.is-compact { padding: 4px 8px; font-size: 11px; }
.dfp-tr-input:focus, .dfp-tr-textarea:focus { border-color: var(--dfp-accent); }
.dfp-tr-check { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--dfp-text-2); cursor: pointer; }
.dfp-tr-check input { accent-color: var(--dfp-accent); }
.dfp-tr-inline-row { display: flex; align-items: center; gap: 6px; }
.dfp-tr-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.dfp-tr-btn, .dfp-tr-btn-sm {
  border: 0.5px solid var(--dfp-border); background: var(--dfp-surface); color: var(--dfp-text);
  border-radius: 8px; font: inherit; font-weight: 500; cursor: pointer; transition: all 120ms ease;
}
.dfp-tr-btn { padding: 6px 11px; font-size: 11.5px; }
.dfp-tr-btn-sm { padding: 4px 9px; font-size: 11px; }
.dfp-tr-btn:hover:not(:disabled), .dfp-tr-btn-sm:hover:not(:disabled) { background: var(--dfp-hover); border-color: var(--dfp-accent); }
.dfp-tr-btn:disabled, .dfp-tr-btn-sm:disabled { opacity: 0.45; cursor: default; }
.dfp-tr-btn.is-primary, .dfp-tr-btn-sm.is-primary { background: var(--dfp-accent); color: var(--dfp-accent-fg); border-color: transparent; }
.dfp-tr-btn.is-ok, .dfp-tr-btn-sm.is-ok { background: var(--dfp-ok-soft); color: var(--dfp-ok); border-color: rgba(18, 183, 106, 0.35); }
.dfp-tr-btn.is-warn, .dfp-tr-btn-sm.is-warn { background: var(--dfp-warn-soft); color: var(--dfp-warn); border-color: rgba(247, 144, 9, 0.35); }
.dfp-tr-btn.is-danger, .dfp-tr-btn-sm.is-danger { color: var(--dfp-err); border-color: rgba(217, 45, 32, 0.3); }
.dfp-tr-del-mini {
  width: 20px; height: 20px; border: 0; border-radius: 6px; background: transparent;
  color: var(--dfp-text-3); cursor: pointer; font-size: 14px; line-height: 1; flex: none;
}
.dfp-tr-del-mini:hover { background: var(--dfp-err-soft); color: var(--dfp-err); }
.dfp-tr-link-btn {
  border: 0; background: transparent; color: var(--dfp-accent); font: inherit; font-size: 11px; cursor: pointer; padding: 1px 4px;
}

.dfp-tr-better {
  margin-top: 4px; padding: 8px 10px; border-radius: 9px;
  background: var(--dfp-ok-soft); border: 0.5px solid rgba(18, 183, 106, 0.32);
}
.dfp-tr-better-title { font-size: 11.5px; font-weight: 600; color: var(--dfp-ok); margin-bottom: 2px; }
.dfp-tr-better-line { font-size: 11px; color: var(--dfp-ok); margin-top: 3px; }

.dfp-tr-q-list, .dfp-tr-steps, .dfp-tr-rounds { display: flex; flex-direction: column; gap: 7px; margin-top: 4px; }
.dfp-tr-q { padding: 8px 9px; border-radius: 9px; border: 0.5px solid var(--dfp-border); background: var(--dfp-bg); display: flex; flex-direction: column; gap: 5px; }
.dfp-tr-q.is-pending { border-color: rgba(247, 144, 9, 0.45); background: var(--dfp-warn-soft); }
.dfp-tr-q-text { font-size: 11.5px; font-weight: 500; color: var(--dfp-text); }

.dfp-tr-step { padding: 7px 9px; border-radius: 9px; border: 0.5px solid var(--dfp-border); background: var(--dfp-bg); display: flex; flex-direction: column; gap: 5px; }
.dfp-tr-step-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dfp-tr-step-no { font-size: 11px; font-weight: 650; color: var(--dfp-accent); flex: none; }
.dfp-tr-step-summary { font-size: 11.5px; color: var(--dfp-text); flex: 1; min-width: 0; word-break: break-word; }
.dfp-tr-frame { width: 100%; max-height: 220px; object-fit: contain; border-radius: 7px; border: 0.5px solid var(--dfp-border); background: #000; }

.dfp-tr-round { padding: 9px 10px; border-radius: 9px; border: 0.5px solid var(--dfp-border); background: var(--dfp-bg); }
.dfp-tr-round.is-accepted { border-color: rgba(18, 183, 106, 0.45); background: var(--dfp-ok-soft); }
.dfp-tr-round.is-needs_fix { border-color: rgba(247, 144, 9, 0.45); }
.dfp-tr-human-note {
  margin-top: 5px; padding: 5px 8px; border-radius: 7px; font-size: 11px;
  background: var(--dfp-surface); border: 0.5px solid var(--dfp-border); color: var(--dfp-text-2);
}
.dfp-tr-receipt {
  padding: 12px 13px; border-radius: 12px;
  background: var(--dfp-ok-soft); border: 0.5px solid rgba(18, 183, 106, 0.42);
}
.dfp-tr-receipt-title { font-size: 13px; font-weight: 650; color: var(--dfp-ok); margin-bottom: 4px; }
`

    return {
      inject,
      apply,
      __internals: { NS, KIND, ID, CSS, zh, en },
    }
  },
})
