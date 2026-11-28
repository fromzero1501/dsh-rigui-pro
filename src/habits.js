// 日晷 Pro · 日常琐事与规律
// 记录仍然写在 localStorage 的 dsh-rigui:v1 里（type:'routine'）；
// 这里只负责：默认规律、读写规律、从记录里算出「今天喝了几次水 / 距上次洗头几天」。
export const RULES_KEY = 'dsh-rigui:rules'
const DAY = 86400000

export const ROUTINE = {
  water: { name: '喝水', color: '#3B82C4', icon: 'water', per: 250 },
  shower: { name: '洗澡', color: '#3D4FB8', icon: 'shower' },
  hair: { name: '洗头', color: '#7C5CE0', icon: 'hair' },
  meal: { name: '吃饭', color: '#F2994A', icon: 'meal' },
  sleep: { name: '睡觉', color: '#3D4FB8', icon: 'sleep' },
  teeth: { name: '刷牙', color: '#0E8A8A', icon: 'teeth' },
  stretch: { name: '站起来走走', color: '#1E9E6A', icon: 'stretch' },
  custom: { name: '这件事', color: '#6B7280', icon: 'dot' },
}
export const routineName = (k) => (ROUTINE[k] || ROUTINE.custom).name

export const DEFAULT_RULES = [
  { id: 'water', kind: 'water', title: '喝水', mode: 'interval', everyMin: 90, from: '09:00', to: '21:00', per: 250, enabled: true },
  { id: 'breakfast', kind: 'meal', title: '吃早饭', mode: 'fixed', times: ['07:30'], enabled: true },
  { id: 'lunch', kind: 'meal', title: '吃午饭', mode: 'fixed', times: ['12:00'], enabled: true },
  { id: 'dinner', kind: 'meal', title: '吃晚饭', mode: 'fixed', times: ['18:00'], enabled: true },
  { id: 'shower', kind: 'shower', title: '洗澡', mode: 'gap', minGapDays: 3, at: '22:30', enabled: true },
  { id: 'hair', kind: 'hair', title: '洗头', mode: 'gap', minGapDays: 3, at: '21:30', enabled: true },
  { id: 'sleep', kind: 'sleep', title: '该睡了', mode: 'fixed', times: ['23:30'], enabled: true },
]

// 老版本把洗澡写成「每天 22:30」；现在改成和洗头一样按间隔算，读到旧的自动换过来
function migrate(r) {
  if (r && r.id === 'shower' && r.mode !== 'gap') return { ...r, mode: 'gap', minGapDays: 3, at: '22:30', times: undefined }
  return r
}

export function loadRules() {
  try {
    const v = JSON.parse(localStorage.getItem(RULES_KEY))
    if (Array.isArray(v) && v.length) {
      const ids = new Set(v.map((r) => r && r.id))
      return v.filter((r) => r && r.id).concat(DEFAULT_RULES.filter((r) => !ids.has(r.id))).map(migrate)
    }
  } catch (e) {}
  return DEFAULT_RULES.map((r) => ({ ...r }))
}

export function saveRules(rules) {
  try { localStorage.setItem(RULES_KEY, JSON.stringify(rules)) } catch (e) {}
}
export function loadRulesRaw() {
  try { return JSON.parse(localStorage.getItem(RULES_KEY)) } catch (e) { return null }
}

export const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }
export const pad2 = (n) => (n < 10 ? '0' : '') + n
export const fmtHM = (t) => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) }
export const fmtDay = (t) => { const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate() }

/** 今天每条规律做到没：{ water:{count, ml, last}, shower:{last, days}, … } */
export function routineToday(records, now = Date.now()) {
  const today = startOfDay(now)
  const out = {}
  for (const r of records) {
    if (r.type !== 'routine' || !r.kind) continue
    const k = r.kind
    if (!out[k]) out[k] = { count: 0, ml: 0, last: 0, lastAt: 0 }
    if (r.t >= today) { out[k].count++; out[k].ml += r.amount || 0 }
    if (r.t > out[k].lastAt) { out[k].lastAt = r.t; out[k].last = r.t }
  }
  return out
}

/** 距上次做这件事多久（天/小时），没记过就是 null */
export function sinceLast(records, kind, now = Date.now()) {
  let last = 0
  for (const r of records) if (r.type === 'routine' && r.kind === kind && r.t > last) last = r.t
  if (!last) return null
  const ms = now - last
  return { at: last, ms, days: Math.floor(ms / DAY), hours: ms / 3600000 }
}

/** 这句话是不是在说一件日常琐事：返回 kind 或 null（AI 不可用时的本地兜底） */
export function guessRoutine(text) {
  const t = String(text || '')
  if (/喝水|喝水了|喝了杯|喝了一杯|喝口水|喝水\d|补水/.test(t)) return 'water'
  if (/洗头|洗了头|洗个头/.test(t)) return 'hair'
  if (/洗澡|洗了个澡|冲了个澡|冲澡/.test(t)) return 'shower'
  if (/刷牙|刷了牙/.test(t)) return 'teeth'
  if (/站起来|走走|活动一下|伸展/.test(t)) return 'stretch'
  return null
}

/** 从这句话里猜水量（毫升），没提就 null */
export function guessWater(text) {
  const t = String(text || '')
  const ml = /(\d{3,4})\s*(?:ml|毫升)/i.exec(t)
  if (ml) return +ml[1]
  if (/一大杯|大杯/.test(t)) return 500
  if (/半杯/.test(t)) return 120
  if (/两杯|２杯|2\s*杯/.test(t)) return 500
  return 250
}

/** 把一条规律说成人话（排程时给 AI 当上下文） */
export function ruleLine(rules) {
  return rules.filter((r) => r.enabled !== false).map((r) => {
    if (r.mode === 'fixed') return `${r.title} ${(r.times || []).join('/')}`
    if (r.mode === 'interval') return `${r.title} 每 ${r.everyMin} 分钟（${r.from}–${r.to}）`
    if (r.mode === 'gap') return `${r.title} 每 ${r.minGapDays} 天`
    return r.title
  }).join('；')
}
