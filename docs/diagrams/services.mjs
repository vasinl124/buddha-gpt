// Generates the services diagrams: docs/services.svg, every service and link as it runs locally
// (PRD §7.1), and docs/railway.svg, the hosted app (PRD §7.4). Edge numbers match those tables;
// change both together. Run: pnpm diagram (elkjs is a root dev dependency)
import ELK from 'elkjs/lib/elk.bundled.js'
import { writeFileSync } from 'node:fs'

const [outPath, view = 'services'] = process.argv.slice(2)
if (!outPath) throw new Error('usage: node services.mjs <out.svg> [services|railway]')

const KIND = {
  ts: ['#E8F0FE', '#3B6FD4'],
  go: ['#E3F5F2', '#1B8A7A'],
  db: ['#F0EBFA', '#6B4FBB'],
  ext: ['#F3F4F6', '#9CA3AF'],
}
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
// ponytail: text width is estimated from character count, not measured; widen the factor if labels clip
const textWidth = (s, size) => Math.ceil(s.length * size * 0.58)

function box(id, kind, title, lines = []) {
  const width = Math.max(textWidth(title, 15), ...lines.map(l => textWidth(l, 12)), 90) + 28
  return { id, kind, title, lines, width, height: 36 + lines.length * 17 }
}

const label = text => ({ text, width: textWidth(text, 12) + 12, height: 18, layoutOptions: { 'elk.edgeLabels.placement': 'CENTER' } })
// style: 'solid' (a user is waiting) | 'dashed' (batch job: nobody waits)
const E = (n, from, to, text, style = 'solid') => ({
  id: `e${n}-${from}-${to}`, style, labels: [label(text)], sources: [from], targets: [to],
})

const VIEWS = {
  services: {
    heading: 'buddha-gpt · services and how they talk',
    desc: 'Every runtime component of buddha-gpt and every link between them, numbered 1 to 11 to match the link table in PRD section 7.1. Solid arrows are calls a user is waiting on; dashed arrows are batch jobs (ingest and evals) that nobody waits on.',
    footer: 'Numbers match the link table in PRD §7.1.',
    nodes: [
      box('browser', 'ts', 'Browser', ['chat UI · sign in', 'guest history in localStorage']),
      box('web', 'ts', 'Web app', ['Next.js 16 · :5005', 'serves pages only']),
      box('agent', 'ts', 'Agent', ['Express 5 + AI SDK 7 · :7891', 'guard · tool loop · checks', 'session cookie → core token']),
      box('eval', 'go', 'buddha eval', ['Go CLI · golden set + judge', 'run by GitHub Actions on PRs']),
      box('retrieval', 'go', 'Retrieval API', ['Go · buddha serve · :7890', 'hybrid search · passages · cards', 'accounts · saved chats']),
      box('sync', 'go', 'buddha sync', ['Go CLI · batch', 'download · clean · embed']),
      box('pg', 'db', 'Postgres 18', ['pgvector + pg_trgm · :5432', 'suttas · paras · vectors', 'users · sessions · chats']),
      box('openrouter', 'ext', 'OpenRouter', ['HTTPS · :443', 'chat · guard · embeddings · judge']),
      box('sources', 'ext', 'Sources', ['VRI Pali XML · Thai Royal PDFs', 'Ṭhānissaro pages · public-domain scans']),
    ],
    edges: [
      E(1, 'browser', 'web', '1 pages'),
      E(2, 'browser', 'agent', '2 chat SSE · account JSON'),
      E(3, 'agent', 'openrouter', '3 guard + reply'),
      E(4, 'agent', 'retrieval', '4 HTTP/JSON'),
      E(5, 'retrieval', 'pg', '5 SQL · search · accounts'),
      E(6, 'retrieval', 'openrouter', '6 embed query'),
      E(7, 'sync', 'sources', '7 download', 'dashed'),
      E(8, 'sync', 'openrouter', '8 embed', 'dashed'),
      E(9, 'sync', 'pg', '9 upsert', 'dashed'),
      E(10, 'eval', 'agent', '10 eval mode', 'dashed'),
      E(11, 'eval', 'openrouter', '11 judge', 'dashed'),
    ],
  },
  railway: {
    heading: 'buddha-gpt on Railway · one public domain',
    desc: 'The hosted app on Railway, numbered 1 to 7 to match the table in PRD section 7.4. Only the web service has a public domain: it proxies /agent to the agent over the private network, so the session cookie is first-party. The agent, the core and Postgres are private. The dashed arrow is the one-time load of the canon.',
    footer: 'Numbers match the hosting table in PRD §7.4.',
    nodes: [
      box('browser', 'ts', 'Browser', ['phone or laptop']),
      box('web', 'ts', 'web', ['Next.js · buddha.maxlim.xyz via Cloudflare', 'pages · proxies /agent/*']),
      box('agent', 'ts', 'agent', ['Express + AI SDK · private :7891', 'chat turns · accounts · limits']),
      box('core', 'go', 'core', ['Go · buddha serve · private :7890', 'search · cards · accounts']),
      box('pg', 'db', 'db', ['pgvector/pgvector:pg18 · volume', 'canon · vectors · users · chats']),
      box('openrouter', 'ext', 'OpenRouter', ['HTTPS · :443', 'guard · reply · embeddings']),
      box('mac', 'ext', 'Your machine', ['pg_dump of the local database']),
    ],
    edges: [
      E(1, 'browser', 'web', '1 HTTPS · pages, /agent/*'),
      E(2, 'web', 'agent', '2 private · HTTP'),
      E(3, 'agent', 'core', '3 private · HTTP/JSON'),
      E(4, 'core', 'pg', '4 private · SQL'),
      E(5, 'agent', 'openrouter', '5 guard + reply'),
      E(6, 'core', 'openrouter', '6 embed query'),
      E(7, 'mac', 'pg', '7 one-time pg_restore', 'dashed'),
    ],
  },
}
if (!VIEWS[view]) throw new Error(`no view ${view}: services or railway`)
const { heading, desc, footer, nodes, edges } = VIEWS[view]

const graph = await new ELK().layout({
  id: 'root',
  layoutOptions: {
    'elk.algorithm': 'layered',
    'elk.direction': 'DOWN',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.spacing.nodeNode': '28',
    'elk.layered.spacing.nodeNodeBetweenLayers': '64',
    'elk.spacing.edgeNode': '16',
    'elk.spacing.edgeEdge': '10',
    'elk.layered.spacing.edgeNodeBetweenLayers': '16',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '10',
    'elk.spacing.edgeLabel': '3',
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    'elk.layered.thoroughness': '40',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  },
  children: nodes,
  edges,
})

// ---- render ----
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const OX = 40, OY = 126
const out = []
const W = Math.ceil(graph.width) + OX * 2, H = Math.ceil(graph.height) + OY + 56

for (const n of graph.children) {
  const [fill, stroke] = KIND[n.kind]
  const x = OX + n.x, y = OY + n.y, cx = x + n.width / 2
  out.push(`<rect x="${x}" y="${y}" width="${n.width}" height="${n.height}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`)
  out.push(`<text x="${cx}" y="${y + 23}" text-anchor="middle" font-size="15" font-weight="700" fill="#111827">${esc(n.title)}</text>`)
  n.lines.forEach((l, i) =>
    out.push(`<text x="${cx}" y="${y + 23 + 17 * (i + 1)}" text-anchor="middle" font-size="12" fill="#4B5563">${esc(l)}</text>`))
}

const labels = []
for (const e of graph.edges) {
  const dash = edges.find(x => x.id === e.id).style === 'dashed' ? ' stroke-dasharray="6 5"' : ''
  for (const s of e.sections ?? []) {
    const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map(p => `${OX + p.x},${OY + p.y}`).join(' ')
    out.push(`<polyline points="${pts}" fill="none" stroke="#374151" stroke-width="1.8"${dash} marker-end="url(#arrow)"/>`)
  }
  for (const l of e.labels ?? []) labels.push(l)
}
// labels go last, on their own background, so lines pass behind them
for (const l of labels) {
  const x = OX + l.x, y = OY + l.y
  const [num, ...rest] = l.text.split(' ')
  out.push(`<rect x="${x}" y="${y}" width="${l.width}" height="${l.height}" rx="4" fill="#FFFFFF" fill-opacity="0.92"/>`)
  out.push(`<text x="${x + l.width / 2}" y="${y + 13}" text-anchor="middle" font-size="12" fill="#1F2937"><tspan font-weight="700">${esc(num)}</tspan>${rest.length ? ' ' + esc(rest.join(' ')) : ''}</text>`)
}

const legend = [
  `<line x1="40" y1="70" x2="80" y2="70" stroke="#374151" stroke-width="2" marker-end="url(#arrow)"/>`,
  `<text x="90" y="74" font-size="12.5" fill="#374151">a user is waiting</text>`,
  `<line x1="240" y1="70" x2="280" y2="70" stroke="#374151" stroke-width="2" stroke-dasharray="6 5" marker-end="url(#arrow)"/>`,
  `<text x="290" y="74" font-size="12.5" fill="#374151">batch job: nobody waits</text>`,
]
let lx = 40
for (const [name, k] of [['TypeScript', 'ts'], ['Go', 'go'], ['database', 'db'], ['external', 'ext']]) {
  legend.push(`<rect x="${lx}" y="87" width="14" height="14" rx="3" fill="${KIND[k][0]}" stroke="${KIND[k][1]}"/>`)
  legend.push(`<text x="${lx + 20}" y="98" font-size="12.5" fill="#374151">${name}</text>`)
  lx += 20 + textWidth(name, 12.5) + 22
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="${SANS}">
<title>${esc(heading)}</title>
<desc>${esc(desc)}</desc>
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#374151"/></marker></defs>
<rect width="${W}" height="${H}" fill="#FFFFFF"/>
<text x="40" y="42" font-size="22" font-weight="700" fill="#111827">${esc(heading)}</text>
${legend.join('\n')}
${out.join('\n')}
<text x="40" y="${H - 22}" font-size="12.5" fill="#4B5563">${esc(footer)}</text>
</svg>
`
writeFileSync(outPath, svg)
console.log(`wrote ${outPath} (${W}×${H})`)
