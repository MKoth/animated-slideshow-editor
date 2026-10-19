// Three variants of the scenario MD modal (?variant=A|B|C) on throwaway route
// /prototype/scenario-md — PROTOTYPE, not production. No tests, no backend.
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

export const PROTOTYPE_VARIANTS = ['A', 'B', 'C'] as const
export type PrototypeVariant = (typeof PROTOTYPE_VARIANTS)[number]

// --- Stub data (from #454 example MD + #455 version rules) -----------------
const SAMPLE_MD = `# Ser vs Estar — Mini Lesson

## Step 1 — Who you are

**Narrator:** Ser is for who you are — identity that does not change by the hour.

![Young doctor smiling](asset:young-doctor-smiling)

> Brief: Warm flat-cartoon portrait of a young doctor, chalkboard-poster style, off-white on dark green.

## Step 2 — Where you are

**Narrator:** Estar is for where and how you are right now.

![Empty classroom chairs](asset:empty-classroom-chairs)

<!-- reuse: Classroom Chairs -->

Estamos en clase — we are in class, for now.`

interface ChecklistRow {
  alt: string
  slug: string
  status: 'bound' | 'brief-only' | 'missing'
  detail: string
}

const CHECKLIST: ChecklistRow[] = [
  {
    alt: 'Young doctor smiling',
    slug: 'young-doctor-smiling',
    status: 'brief-only',
    detail: 'Brief present — no library asset bound yet',
  },
  {
    alt: 'Empty classroom chairs',
    slug: 'empty-classroom-chairs',
    status: 'bound',
    detail: 'Reuse → Classroom Chairs (library)',
  },
  {
    alt: 'Chalkboard ser vs estar table',
    slug: 'chalkboard-ser-vs-estar-table',
    status: 'missing',
    detail: 'No brief, no reuse ref — warning-only per #454',
  },
]

interface MdVersion {
  id: string
  summary: string
  touched: string
  at: string
}

const VERSIONS: MdVersion[] = [
  { id: 'v3', summary: 'Added Step 2 brief; touched Steps 2', touched: 'Steps 2', at: '10:41' },
  { id: 'v2', summary: 'Split Step 1 table; touched Steps 1–2', touched: 'Steps 1–2', at: '10:12' },
  { id: 'v1', summary: 'Initial MD draft; touched Steps 1–2', touched: 'Steps 1–2', at: '09:58' },
]

type HtmlState = 'none' | 'missing' | 'ready'

const STATUS_LABEL: Record<ChecklistRow['status'], string> = {
  bound: 'Bound',
  'brief-only': 'Brief only',
  missing: 'Missing',
}

function ChecklistList({ compact }: { compact?: boolean }) {
  const [filter, setFilter] = useState<'all' | 'missing'>('all')
  const rows = useMemo(
    () => (filter === 'all' ? CHECKLIST : CHECKLIST.filter((r) => r.status !== 'bound')),
    [filter],
  )
  return (
    <div data-testid="prototype-checklist">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <strong>Asset checklist ({rows.length})</strong>
        <button onClick={() => setFilter(filter === 'all' ? 'missing' : 'all')}>
          {filter === 'all' ? 'Show missing only' : 'Show all'}
        </button>
      </div>
      {rows.map((row) => (
        <div
          key={row.slug}
          data-testid={`prototype-checklist-${row.slug}`}
          style={{
            border: '1px solid #888',
            borderRadius: 6,
            padding: compact ? 6 : 10,
            marginBottom: 6,
          }}
        >
          <div>
            <code>{row.alt}</code> → <code>asset:{row.slug}</code> —{' '}
            <b>{STATUS_LABEL[row.status]}</b>
          </div>
          {!compact && <div style={{ opacity: 0.8 }}>{row.detail}</div>}
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button>Bind library asset</button>
            <button>Upload</button>
            <button>Edit brief</button>
          </div>
        </div>
      ))}
    </div>
  )
}

function HistoryTab() {
  const [restored, setRestored] = useState<string | null>(null)
  return (
    <div data-testid="prototype-history">
      <strong>History (append-only, unbounded per #455)</strong>
      {restored && (
        <div>Restored {restored} as new version (Restore-as-new-version, no rewrite)</div>
      )}
      {VERSIONS.map((v) => (
        <div key={v.id} style={{ borderBottom: '1px dotted #888', padding: '6px 0' }}>
          <div>
            <b>{v.id}</b> · {v.summary} · {v.at}
          </div>
          <div style={{ opacity: 0.75 }}>diff vs prev: ~line/block diff placeholder</div>
          <button onClick={() => setRestored(v.id)}>Restore as new version</button>
        </div>
      ))}
    </div>
  )
}

function ChatSnippet() {
  return (
    <div
      data-testid="prototype-chat"
      style={{ border: '1px dashed #888', borderRadius: 6, padding: 8, marginBottom: 8 }}
    >
      <div>
        <i>assistant [edit]</i>: Updated Step 2 — should I also split Step 3?{' '}
        <span style={{ opacity: 0.75 }}>
          (mixed reply: edit applied as new version, question stays)
        </span>
      </div>
      <div style={{ opacity: 0.85 }}>
        ↳ v4 · Added Step 2 brief; touched Steps 2 (one-line summary + link)
      </div>
      <div style={{ marginTop: 6 }}>
        <code>/ask</code> forces question-only · <code>/edit</code> forces edit
      </div>
    </div>
  )
}

// --- Variant A: doc-first modal -------------------------------------------
export function VariantA() {
  const [html, setHtml] = useState<HtmlState>('missing')
  const [tab, setTab] = useState<'doc' | 'history'>('doc')
  const blocked = CHECKLIST.some((r) => r.status !== 'bound')
  return (
    <div data-testid="prototype-variant-a">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <span style={{ border: '1px solid #888', padding: '2px 8px' }}>
          AiPanel · Scenario mode · [Scenario MD] entry button (header, always present)
        </span>
      </div>
      <h2>Variant A — Doc-first modal</h2>
      <p>
        Full MD doc center, right-rail checklist, top-bar Generate / View HTML, bottom History tab.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button
          data-testid="prototype-generate"
          disabled={blocked}
          onClick={() => setHtml('ready')}
          title={blocked ? 'Blocked: resolve missing assets first' : 'Generate HTML'}
        >
          Generate HTML {blocked ? '(blocked — 2 unbound)' : ''}
        </button>
        <button data-testid="prototype-view" disabled={html !== 'ready'}>
          View HTML{' '}
          {html === 'ready' ? '' : html === 'none' ? '(no HTML yet)' : '(stale — regenerate)'}
        </button>
        <button disabled={html !== 'ready'}>Download .zip</button>
        <span data-testid="prototype-html-state">html: {html}</span>
      </div>
      <div>
        <button onClick={() => setTab('doc')} disabled={tab === 'doc'}>
          Doc
        </button>{' '}
        <button onClick={() => setTab('history')} disabled={tab === 'history'}>
          History
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginTop: 8 }}>
        <div>
          {tab === 'doc' ? (
            <pre style={{ whiteSpace: 'pre-wrap', border: '1px solid #888', padding: 8 }}>
              {SAMPLE_MD}
            </pre>
          ) : (
            <HistoryTab />
          )}
        </div>
        <ChecklistList />
      </div>
      <ChatSnippet />
    </div>
  )
}

// --- Variant B: chat-anchored drawer ---------------------------------------
export function VariantB() {
  const [html, setHtml] = useState<HtmlState>('none')
  const [open, setOpen] = useState(true)
  const blocked = CHECKLIST.some((r) => r.status !== 'bound')
  return (
    <div data-testid="prototype-variant-b">
      <h2>Variant B — Chat-anchored drawer</h2>
      <p>
        MD docks beside the conversation; inline summaries link to versions; checklist gates
        Generate.
      </p>
      <div style={{ border: '1px solid #888', padding: 8, marginBottom: 8 }}>
        AiPanel chat … assistant message ·{' '}
        <button onClick={() => setOpen(!open)}>[Scenario MD]</button>{' '}
        <span style={{ opacity: 0.7 }}>(entry lives next to the message + mode header)</span>
      </div>
      {open && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <ChatSnippet />
            <HistoryTab />
          </div>
          <div>
            <pre style={{ whiteSpace: 'pre-wrap', border: '1px solid #888', padding: 8 }}>
              {SAMPLE_MD}
            </pre>
            <ChecklistList compact />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button disabled={blocked} onClick={() => setHtml('ready')}>
                Generate HTML {blocked ? '(blocked)' : ''}
              </button>
              <button disabled={html !== 'ready'}>View HTML</button>
              <span data-testid="prototype-html-state">html: {html}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// --- Variant C: stepped wizard ---------------------------------------------
export function VariantC() {
  const [step, setStep] = useState<0 | 1 | 2>(1)
  const [html, setHtml] = useState<HtmlState>('ready')
  const blocked = CHECKLIST.some((r) => r.status !== 'bound')
  return (
    <div data-testid="prototype-variant-c">
      <h2>Variant C — Stepped wizard (Read → Assets → Publish)</h2>
      <p>
        Checklist is a full page; Generate unlocks only when all rows bind; Publish shows preview +
        .zip.
      </p>
      <div style={{ border: '1px solid #888', padding: 8, marginBottom: 8 }}>
        AiPanel · Scenario mode · [Scenario MD] entry button opens wizard at Read
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['Read', 'Assets', 'Publish'] as const).map((label, i) => (
          <button key={label} disabled={step === i} onClick={() => setStep(i as 0 | 1 | 2)}>
            {i + 1}. {label} {i === 1 && blocked ? '(2 open)' : ''}
          </button>
        ))}
      </div>
      {step === 0 && (
        <pre style={{ whiteSpace: 'pre-wrap', border: '1px solid #888', padding: 8 }}>
          {SAMPLE_MD}
        </pre>
      )}
      {step === 1 && (
        <>
          <ChecklistList />
          <button
            disabled={blocked}
            onClick={() => {
              setHtml('ready')
              setStep(2)
            }}
          >
            Generate HTML {blocked ? '(blocked — bind all first)' : '(all bound → Publish)'}
          </button>
        </>
      )}
      {step === 2 && (
        <div>
          <div data-testid="prototype-html-state">html: {html}</div>
          <div
            style={{
              background: '#20302A',
              color: '#F4F1E8',
              borderRadius: 8,
              padding: 16,
              margin: '8px 0',
            }}
          >
            <h3 style={{ fontFamily: 'cursive', margin: '0 0 8px' }}>
              Ser vs Estar (chalk preview)
            </h3>
            <p>
              Chalk theme applied (Cabin Sketch + Kalam, #20302A board). Offline, no remote URLs.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button>View HTML (full page)</button>
            <button>Download .zip (index.html + assets/ + fonts/ + manifest.json)</button>
            <button onClick={() => setHtml('ready')}>Re-generate</button>
          </div>
          <HistoryTab />
        </div>
      )}
    </div>
  )
}

// --- Switcher + route -------------------------------------------------------
const NAMES: Record<PrototypeVariant, string> = {
  A: 'Doc-first modal',
  B: 'Chat-anchored drawer',
  C: 'Stepped wizard',
}

export function ScenarioMdModalPrototypeRoute() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('variant')
  const variant: PrototypeVariant = raw === 'B' ? 'B' : raw === 'C' ? 'C' : 'A'
  const cycle = (dir: 1 | -1) => {
    const order: PrototypeVariant[] = ['A', 'B', 'C']
    const next = order[(order.indexOf(variant) + dir + order.length) % order.length]
    setParams({ variant: next }, { replace: true })
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'ArrowLeft') cycle(-1)
      if (e.key === 'ArrowRight') cycle(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant])
  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: '0 auto' }}>
      <p style={{ opacity: 0.7 }}>
        PROTOTYPE for{' '}
        <a href="https://github.com/MKoth/animated-slideshow-editor/issues/457">#457</a> —
        throwaway, in-memory only. Run: <code>npm run dev --prefix frontend</code> →{' '}
        <code>/prototype/scenario-md?variant={variant}</code>
      </p>
      {variant === 'A' && <VariantA />}
      {variant === 'B' && <VariantB />}
      {variant === 'C' && <VariantC />}
      {import.meta.env.PROD !== true && (
        <div
          style={{
            position: 'fixed',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#111',
            color: '#fff',
            borderRadius: 999,
            padding: '6px 12px',
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            zIndex: 9999,
          }}
        >
          <button aria-label="Previous variant" onClick={() => cycle(-1)}>
            ←
          </button>
          <span>
            {variant} — {NAMES[variant]}
          </span>
          <button aria-label="Next variant" onClick={() => cycle(1)}>
            →
          </button>
        </div>
      )}
    </div>
  )
}
