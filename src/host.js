// 日晷 Pro · 主机半边
// 1) /api/rigui-pro/parse  把一句话拆成记录（沿用原来的解析器）
// 2) /api/rigui-pro/plan   AI 排程：把「要做的事」拆进一天的时间块
// 3) /api/rigui-pro/coach  每天几句具体的建议（带数字，不说废话）
// 4) /api/rigui-pro/routine 规律与提醒：规则同步、完成打点、到点提醒
// 数据：记录仍在本机浏览器里；这里只存「规律规则 + 最近完成时间 + 待触发提醒」，
// 落在 $DSH_HOME/rigui-pro.json，不出本机。
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

export const name = 'dsh-rigui-pro'
export const inject = ['llm', 'connection']

const ROUTE = '/api/rigui-pro'
const AI_TIMEOUT_MS = 45000
const PLAN_TIMEOUT_MS = 180000
// 排程的输出上限：按你的要求给到 128K。
// 提供方对上限的接受度不一（有的模型只认 8K），被拒就自动降档重试，不会因为撞上限就排不出来。
const AI_MAX_TOKENS = 128000
const STORE_FILE = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'rigui-pro.json')
const DAY = 86400000

// ---------- 在不在电脑前 ----------
// 只读系统的「最后一次输入时间」，不挂键盘钩子、不记按键、不看窗口标题。
// 采样器是 native/idlewatch 编出来的几十 KB 小程序，随 DSH 启停，DSH 关掉它自己就退。
const ACT_EVERY_S = 30 // 采样间隔
const ACT_AWAY_MS = 5 * 60000 // 超过这么久没输入就算离开
const ACT_FOCUS_MS = 10 * 60000 // 连续坐这么久算专注
const ACT_SEAT_RESET_MS = 3 * 60000 // 离开超过这么久，久坐重新计时
const SIT_AFTER_MIN = 50 // 连坐多久提醒起身
const PLUGIN_DIR = (() => {
  try { return dirname(fileURLToPath(import.meta.url)) } catch { return process.cwd() }
})()

function idlewatchPath() {
  const cands = [
    process.env.RIGUI_IDLEWATCH,
    join(PLUGIN_DIR, 'native', 'idlewatch.exe'),
    join(PLUGIN_DIR, 'node_modules', 'dsh-rigui-pro', 'native', 'idlewatch.exe'),
    join(process.cwd(), 'native', 'idlewatch.exe'),
  ].filter(Boolean)
  for (const p of cands) { try { if (existsSync(p)) return p } catch {} }
  return ''
}

function actDefaults() {
  return { state: 'unknown', since: 0, seatStart: 0, waterMs: 0, focusMs: 0, day: '', lastIdle: 0, lastSampleAt: 0, helper: '' }
}

function readAct(s) { return { ...actDefaults(), ...((s && s.act) || {}) } }

// 一次采样：更新状态、久坐起点、喝水累计、专注累计
function feedSample(s, now, idle) {
  const a = readAct(s)
  const today = ymd(new Date(now))
  if (a.day !== today) { a.day = today; a.focusMs = 0; a.waterMs = 0 }
  const gap = a.lastSampleAt ? Math.max(0, Math.min(now - a.lastSampleAt, ACT_EVERY_S * 2000)) : 0
  const wasUp = a.state === 'desk' || a.state === 'focus'
  if (idle >= ACT_AWAY_MS) {
    if (a.state !== 'away') { a.state = 'away'; a.since = now - idle }
    a.seatStart = 0
  } else {
    if (!a.seatStart) a.seatStart = now - Math.min(idle, ACT_SEAT_RESET_MS)
    const seated = now - a.seatStart
    const next = seated >= ACT_FOCUS_MS ? 'focus' : 'desk'
    if (next !== a.state) { a.state = next; a.since = now }
    // 只在「上次采样时人也在」的间隔里累加，跨过离开的那一段不算
    if (wasUp && gap) {
      a.waterMs = (a.waterMs || 0) + gap
      if (next === 'focus') a.focusMs = (a.focusMs || 0) + gap
    }
  }
  a.lastIdle = idle
  a.lastSampleAt = now
  s.act = a
  return a
}

// 交给界面的那一份
function actView(s, now) {
  const a = readAct(s)
  return {
    state: a.state,
    since: a.since,
    sinceMs: a.since ? Math.max(0, now - a.since) : 0,
    seatMs: a.seatStart ? Math.max(0, now - a.seatStart) : 0,
    focusMs: a.focusMs || 0,
    waterMs: a.waterMs || 0,
    idle: a.lastIdle || 0,
    sampleAt: a.lastSampleAt || 0,
    helper: a.helper || '',
  }
}

// 喝水与起身这两件事按「在电脑前的时间」算，不看钟点：
// - 喝水：上次喝水之后累计坐满 everyMin 分钟才提醒，离开的那段不算
// - 起身：连续坐满 afterMin 分钟提醒一次，起来（离开 3 分钟以上）就重新计时
// 返回 null 表示这条规则不归活动管，交给原来的钟点逻辑。
function actDue(rule, s, now) {
  if (rule.kind === 'water' && rule.mode === 'interval') {
    if (readAct(s).state === 'away') return ''
    const every = Math.max(15, rule.everyMin || 90) * 60000
    if ((readAct(s).waterMs || 0) < every) return ''
    return 'act:water@' + (lastLogOf(s, 'water', now) || 0)
  }
  if (rule.id === 'stand') {
    const a = readAct(s)
    if (!a.seatStart || a.state === 'away') return ''
    const after = Math.max(15, Math.min(180, rule.afterMin || SIT_AFTER_MIN)) * 60000
    if (now - a.seatStart < after) return ''
    return 'act:stand@' + a.seatStart
  }
  return null
}


// ---------- 提示词 ----------

const PARSE_SYSTEM = `你是「日晷」生活记录工具的解析器。把用户随口说的一句话拆成结构化记录。只输出一个 JSON 对象，不要任何解释或代码块标记。

记录类型（字段名必须一致）：
- 吃喝：{"type":"meal","meal":"breakfast|lunch|dinner|snack","time":"HH:MM"|null,"items":[{"name":"麻团","qty":2,"unit":"个","kcal":460}]}
  · 每一样食物或饮料单独一项；kcal 是这一项按数量算好的总热量，按中国大陆日常一份的分量估，整数。
  · 认识的地方小吃、品牌、菜名都要估，不要漏；实在没听过就按最像的东西估。
  · 没说是哪一餐时按时间判断：早于 10:30 早餐，10:30–14:30 午餐，17:00–21:00 晚餐，其余加餐。
- 花销：{"type":"expense","amount":32,"cat":"餐饮|交通|购物|居家|订阅|宠物|运动|医疗|娱乐|社交|其他","title":"牛肉面"}
- 收入：{"type":"income","amount":18000,"title":"工资"}
- 运动：{"type":"workout","kind":"跑步","minutes":30,"km":5|null,"steps":8000|null,"kcal":375}
- 睡眠：{"type":"sleep","bed":"HH:MM"|null,"wake":"HH:MM"|null,"hours":7.5}
- 体重：{"type":"weight","kg":68.1}
- 日常琐事（喝水、洗澡、洗头、刷牙、站起来活动、吃药等）：{"type":"routine","kind":"water|shower|hair|teeth|stretch|medicine|custom","title":"喝水","amount":250|null}
  · amount 只对喝水有意义，单位毫升；用户说「一杯」按 250，「一大杯」按 500，没说就 null。
  · 洗澡用 shower，洗头用 hair，两个都说了就两条记录。
- 日程（以后要做的、有时间的事）：{"type":"event","title":"…","date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM"|null,"domain":"move|time","minutes":60|null,"kcal":数字|null}
- 待办（没有具体时段、但要做的事）：{"type":"todo","title":"…","amount":数字|null,"remind":"YYYY-MM-DD HH:MM"|null}
  · 用户给了明确的钟点（「九点提醒我交稿」「明天下午三点寄快递」「晚上八点」）就把那个时刻填进 remind；没给钟点就填 null。填了就会按这个时间提醒他。

规则：
- 吃东西又说了价钱：一条 meal 加一条 expense（cat 用 餐饮，title 用吃的东西）。
- 没写单位的数字，按语境判断是钱、分钟还是数量；不确定时，吃饭语境里的两位数多半是钱。
- 「昨天」「明天」「今早」等按现在的时间换算成具体日期和时间。
  · 现在的时间在 00:00–03:59 之间时，用户说的「明天」指的是**当天**（他还没睡，脑子里的「明天」从躺下算起）：1 号凌晨 1 点说「明天九点起」就是 1 号 9 点；这种时候「后天」才等于明天。
- 说的是过去某天的事，在那条记录里加 "date":"YYYY-MM-DD"；今天的事不加 date。
- 一句话里可以有多条记录。
- tokens 列出原句里起关键作用的片段及领域（food、money、move、sleep、body、time、life），片段必须是原句里一字不差的子串。
- note：只有在你明显拿不准时写一句很短的中文说明，否则空字符串。

输出格式：{"records":[…],"tokens":[{"text":"…","domain":"…"}],"note":""}`

const PLAN_SYSTEM = `你是「日晷 Pro」的日程管家，替一位自己做生意的人安排一天。他不是上班族：时间自己定，但要跑执照、剪视频、开直播、回客服，事情杂且容易拖。
用户会说今天或明天要做的事，你要把这些事连同他固定要做的事（吃饭、洗澡、睡觉、喝水）排成一份可以直接执行的时间表。
（凌晨 0–4 点还没睡，这时候他说的「明天」就是 date 这天，不要顺延。）

只输出一个 JSON 对象，不要解释、不要代码块标记：
{"date":"YYYY-MM-DD","summary":"一句话说这份安排的样子","blocks":[{"start":"HH:MM","end":"HH:MM","title":"…","domain":"admin|work|life|move|rest","why":"为什么排在这个位置，一句短话","remind":true}],"notes":["值得提醒他的事，最多两条"],"question":""}

排的规矩：
1. 已有日程是锚点，绝对不能和它们重叠，也不要贴着前后各留 10 分钟缓冲。
2. 三餐和睡觉是固定的：早饭 07:30、午饭 12:00、晚饭 18:00、睡觉按他昨晚的入睡时间和目标反推；吃饭前后各留 20 分钟。
3. 需要出门办事（办证、银行、政务大厅、寄件）放在工作日 09:00–11:30 或 14:00–16:30，别排在午休和傍晚。
4. 费脑的活（写脚本、拍剪、选品、复盘）排上午；机械的活（回客服、搬货、整理）排下午；运动排在晚饭前或早上，别排饭后一小时内。
5. 单块不超过 90 分钟，超过就拆成两块，中间留 10–15 分钟休息。
6. 全部安排加起来不超过当天可用时间的七成，剩下留给他自己。
7. 只排他提到的事和必须做的事，不要替他加一堆「应该做」的活；没提就空着。
8. 时间用 24 小时 HH:MM；不确定时长按经验估，并在 why 里说明是估的。
9. 没说是哪天就按「今天」；已经过去的时段不要排，从下一个整点或半小时开始。
10. 如果他说的事情本身矛盾（比如两个必须同时做的会），在 question 里问一句，不要硬排。

domain 取值：admin（办事、跑腿）、work（干活）、life（吃饭洗澡这类）、move（运动）。`

const COACH_SYSTEM = `你是「日晷 Pro」的管家，只在合适的时候说一两句有用的话。
根据用户今天的数据，给出最多两条建议：每条不超过 26 个字，必须带具体数字或时间，必须是他现在就能做的事。
不要鼓励、不要总结、不要说「继续保持」这类空话；没有值得说的事就返回空数组。
只输出 JSON：{"lines":["…","…"]}`

// ---------- 小工具 ----------
const json = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } })
const pad = (n) => (n < 10 ? '0' : '') + n
const hhmm = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes())
const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }
const minutesOf = (s) => { const m = /^(\d{1,2})[:：](\d{2})$/.exec(String(s || '').trim()); return m ? +m[1] * 60 + +m[2] : null }
const stampOf = (day, min) => day + min * 60000

function extractJSON(text) {
  const t = String(text || '').replace(/```(?:json)?/gi, '').trim()
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a < 0 || b <= a) throw new Error('模型没有给出可用的结果')
  return JSON.parse(t.slice(a, b + 1))
}

// ---------- 提醒仓库 ----------
const DEFAULT_RULES = [
  { id: 'water', kind: 'water', title: '喝水', mode: 'interval', everyMin: 90, from: '09:00', to: '21:00', per: 250, enabled: true },
  { id: 'breakfast', kind: 'meal', title: '吃早饭', mode: 'fixed', times: ['07:30'], enabled: true },
  { id: 'lunch', kind: 'meal', title: '吃午饭', mode: 'fixed', times: ['12:00'], enabled: true },
  { id: 'dinner', kind: 'meal', title: '吃晚饭', mode: 'fixed', times: ['18:00'], enabled: true },
  { id: 'shower', kind: 'shower', title: '洗澡', mode: 'gap', minGapDays: 3, at: '22:30', enabled: true },
  { id: 'hair', kind: 'hair', title: '洗头', mode: 'gap', minGapDays: 3, at: '21:30', enabled: true },
  { id: 'stand', kind: 'stretch', title: '起身', mode: 'sit', afterMin: SIT_AFTER_MIN, enabled: true },
  { id: 'sleep', kind: 'sleep', title: '该睡了', mode: 'fixed', times: ['23:30'], enabled: true },
]

const EMPTY = () => ({ version: 1, rules: DEFAULT_RULES.map((r) => ({ ...r })), logs: [], alarms: [], plans: [], fired: {}, prefs: { quiet: { from: '23:30', to: '07:30' }, system: true }, seenAt: 0, ai: { provider: '', model: '' }, voice: voiceDefaults(), act: actDefaults() })

function readStore() {
  try {
    if (!existsSync(STORE_FILE)) return EMPTY()
    const raw = JSON.parse(readFileSync(STORE_FILE, 'utf8'))
    const s = { ...EMPTY(), ...raw }
    if (!Array.isArray(s.rules) || !s.rules.length) s.rules = EMPTY().rules
    // 老版本把洗澡写成「每天 22:30」，现在按「洗完 3 天」算
    s.rules = s.rules.map((r) => (r && r.id === 'shower' && r.mode !== 'gap' ? { ...r, mode: 'gap', minGapDays: 3, at: '22:30' } : r))
    // 老仓库里没有「起身」这条，补上
    if (!s.rules.some((r) => r && r.id === 'stand')) s.rules.push({ ...DEFAULT_RULES.find((r) => r.id === 'stand') })
    if (!Array.isArray(s.logs)) s.logs = []
    if (!Array.isArray(s.alarms)) s.alarms = []
    if (!Array.isArray(s.plans)) s.plans = []
    if (!s.fired || typeof s.fired !== 'object') s.fired = {}
    s.prefs = { quiet: { from: '23:30', to: '07:30' }, system: true, ...(s.prefs || {}) }
    s.ai = { provider: '', model: '', ...(s.ai || {}) }
    s.act = { ...actDefaults(), ...(s.act || {}) }
    return s
  } catch { return EMPTY() }
}

function writeStore(s) {
  try {
    mkdirSync(dirname(STORE_FILE), { recursive: true })
    const tmp = STORE_FILE + '.tmp'
    writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf8')
    renameSync(tmp, STORE_FILE)
  } catch (e) { console.warn('[dsh-rigui-pro] 存提醒失败', e && e.message) }
}

// 排程失败时把模型原话留一份，方便事后看它到底回了什么（最多留 5 条）
function planDebug(rec) {
  try {
    const f = join(dirname(STORE_FILE), 'rigui-pro-plan-debug.json')
    let arr = []
    try { arr = JSON.parse(readFileSync(f, 'utf8')) } catch {}
    if (!Array.isArray(arr)) arr = []
    arr.push({
      at: rec.at || Date.now(),
      model: String(rec.model || '').slice(0, 60),
      error: String(rec.error || '').slice(0, 200),
      kinds: rec.kinds || {},
      text: String(rec.text || '').slice(0, 2000),
    })
    writeFileSync(f, JSON.stringify(arr.slice(-5), null, 2), 'utf8')
  } catch (e) { console.warn('[dsh-rigui-pro] 排程调试记录没写成', e && e.message) }
}

// ---------- 系统弹窗 ----------
// 只留字母数字与常见中文标点，避免拼进 PowerShell 单引号串里出岔
function esc(v) { return String(v == null ? '' : v).replace(/[`"'\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim() }
// 旧写法是 exec() + 隐藏窗口参数 + base64 编码命令：exec 在 Windows 要经 cmd.exe，
// 而「隐藏窗口 + base64 命令」这两个特征正好撞上安全软件「隐藏执行 PowerShell」那条规则。
// 现在改成 spawn 直接起 powershell、命令行只看得到 -Command，窗口隐藏交给 CreateProcess 的
// windowsHide 参数（它是进程创建标志，不出现在命令行里）。
function notify(title, message) {
  if (platform() !== 'win32') return
  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$n = New-Object System.Windows.Forms.NotifyIcon',
    '$n.Icon = [System.Drawing.SystemIcons]::Information',
    `$n.BalloonTipTitle = '${esc(title)}'`,
    `$n.BalloonTipText = '${esc(message)}'`,
    '$n.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info',
    '$n.Visible = $true',
    '$n.ShowBalloonTip(8000)',
    'Start-Sleep -Seconds 2',
    '$n.Dispose()',
  ].join('; ')
  try {
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      windowsHide: true,
      stdio: 'ignore',
      detached: true,
    })
    child.on('error', () => {})
    child.unref()
  } catch (e) { console.warn('[dsh-rigui-pro] 弹提醒失败', e && e.message) }
}

// ---------- 语音 ----------
// 文案固定几句轮换，不每次问模型；合成结果按「配置 + 文案」落盘缓存复用。
const VOICE_DIR = join(dirname(STORE_FILE), 'rigui-pro', 'voice')
// 参考音频（克隆用）放在插件数据目录里，不需要服务端的音色 ID
const SAMPLE_DIR = join(dirname(STORE_FILE), 'rigui-pro', 'voices')
const MAX_CACHE_FILES = 200
const MAX_SAMPLE_B64 = 9 * 1024 * 1024 // MiMo 那边 base64 上限 10 MB，留点余量
const MAX_SAMPLES = 8

const PHRASES = {
  water: ['来，喝口水。', '杯子该续上了。', '喝一杯，顺手记一下。', '水放这儿了，先喝一口。'],
  shower: ['该洗澡了。', '热水放好，去洗个澡。', '洗澡时间到了。'],
  hair: ['今天该洗头了。', '顺带把头发洗了。'],
  meal: ['到饭点了。', '该吃饭了，别拖。', '先吃口饭再干。'],
  sleep: ['放下手机，睡了。', '该睡了，明天还要干活。', '关灯睡觉。'],
  teeth: ['刷牙去。', '别忘了刷牙。'],
  stretch: ['站起来动一动。', '脖子手腕转一转。'],
  custom: ['到点了。', '该做这件事了。'],
  // 待办与日程念的是「事情标题 + 这几句后缀」，不做逐条生成
  todo: ['到点了，别拖。', '该去做这件事了。', '时间到了，先做这个。'],
  event: ['该开始了。', '到点了，准备一下。', '这件事该上了。'],
}

// 只有这 8 类日常琐事能自己写台词；待办/日程念的是标题 + 内置后缀
const PHRASE_KINDS = ['water', 'shower', 'hair', 'meal', 'sleep', 'teeth', 'stretch', 'custom']
const MAX_LINE = 60

// 每一类的内置第一句，给面板当占位提示和试听兜底
function defaultLines() {
  const out = {}
  for (const k of PHRASE_KINDS) out[k] = (PHRASES[k] && PHRASES[k][0]) || ''
  return out
}

function voiceDefaults() {
  return {
    enabled: true,
    provider: 'cloud',
    read: { water: true, shower: true, hair: true, meal: true, sleep: true, teeth: true, stretch: true, custom: true },
    groups: { routine: true, todo: true, event: true },
    // 用户自己写的台词：一件事一句，留空回退内置那几句轮换
    lines: {},
    leadMin: 5,
    cloud: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini-tts', voice: 'alloy', format: 'mp3' },
    // 小米 MiMo：OpenAI 的 chat/completions 形状，2026-11 起限时免费
    mimo: { baseUrl: 'https://api.xiaomimimo.com/v1', apiKey: '', model: 'mimo-v2.5-tts', voice: 'mimo_default', format: 'mp3' },
    local: { shape: 'gradio', baseUrl: 'http://127.0.0.1:7860', apiName: 'gen_single', voicePath: '', format: 'wav', payload: '' },
    // 存下来的参考音频（本机文件，选一次就一直能用）
    voices: [],
    lastAt: 0,
    lastError: '',
    lastErrorAt: 0,
  }
}

// 老存档缺字段就用默认补齐，不覆盖用户已填的值
function readVoice(store) {
  const d = voiceDefaults()
  const raw = (store && store.voice) || {}
  return {
    ...d,
    ...raw,
    read: { ...d.read, ...(raw.read || {}) },
    groups: { ...d.groups, ...(raw.groups || {}) },
    cloud: { ...d.cloud, ...(raw.cloud || {}) },
    mimo: { ...d.mimo, ...(raw.mimo || {}) },
    local: { ...d.local, ...(raw.local || {}) },
    // 参考音频清单：只认 id 是字符串的条目，名字截短，最多留 8 段
    voices: (Array.isArray(raw.voices) ? raw.voices : []).filter((x) => x && typeof x.id === 'string' && x.id).slice(0, MAX_SAMPLES).map((x) => ({
      id: String(x.id).slice(0, 32),
      name: String(x.name || '我的音色').replace(/[\r\n\t]/g, ' ').slice(0, 24),
      ext: String(x.ext || '.mp3').toLowerCase() === '.wav' ? '.wav' : '.mp3',
      bytes: Number(x.bytes) || 0,
      at: Number(x.at) || 0,
    })),
    // 台词只认这 8 类，非字符串/空白一律不收；显式覆盖掉 ...raw 里带进来的脏值
    lines: (() => {
      const out = {}
      const src = (raw && raw.lines) || {}
      for (const k of PHRASE_KINDS) {
        const s = src[k]
        if (typeof s === 'string' && s.trim()) out[k] = s.replace(/\s+/g, ' ').trim().slice(0, MAX_LINE)
      }
      return out
    })(),
  }
}

const VOICE_FIELDS = {
  cloud: ['baseUrl', 'apiKey', 'model', 'voice', 'format'],
  mimo: ['baseUrl', 'apiKey', 'model', 'voice', 'format'],
  local: ['shape', 'baseUrl', 'apiName', 'voicePath', 'format', 'payload'],
}

function mergeVoice(v, patch) {
  const out = { ...v, read: { ...v.read }, groups: { ...v.groups }, cloud: { ...v.cloud }, mimo: { ...v.mimo }, local: { ...v.local }, lines: { ...(v.lines || {}) }, voices: Array.isArray(v.voices) ? v.voices.slice() : [] }
  if (!patch || typeof patch !== 'object') return out
  if (typeof patch.enabled === 'boolean') out.enabled = patch.enabled
  if (patch.provider === 'cloud' || patch.provider === 'mimo' || patch.provider === 'local') out.provider = patch.provider
  if (patch.read && typeof patch.read === 'object') {
    for (const k of Object.keys(patch.read).slice(0, 20)) {
      if (typeof patch.read[k] === 'boolean') out.read[String(k).slice(0, 16)] = patch.read[k]
    }
  }
  if (patch.groups && typeof patch.groups === 'object') {
    for (const g of ['routine', 'todo', 'event']) {
      if (typeof patch.groups[g] === 'boolean') out.groups[g] = patch.groups[g]
    }
  }
  if (isFinite(+patch.leadMin)) out.leadMin = Math.max(0, Math.min(60, Math.round(+patch.leadMin)))
  if (patch.lines && typeof patch.lines === 'object') {
    for (const k of PHRASE_KINDS) {
      if (!(k in patch.lines)) continue
      const s = patch.lines[k]
      if (typeof s !== 'string') continue
      const t = s.replace(/\s+/g, ' ').trim().slice(0, MAX_LINE)
      // 传空串 = 恢复内置轮换
      if (t) out.lines[k] = t
      else delete out.lines[k]
    }
  }
  for (const group of ['cloud', 'mimo', 'local']) {
    const p = patch[group]
    if (!p || typeof p !== 'object') continue
    for (const f of VOICE_FIELDS[group]) {
      if (typeof p[f] === 'string') out[group][f] = p[f].slice(0, f === 'payload' ? 4000 : 300)
    }
  }
  return out
}

// 同一天同一件事说同一句，隔天换一句；不为每句话去调模型
function phraseFor(store, kind, now) {
  // 用户给这件事写过台词就固定念那句，不再轮换
  const own = store && store.voice && store.voice.lines && store.voice.lines[kind]
  if (typeof own === 'string' && own) return own
  const pool = PHRASES[kind] || PHRASES.custom
  const n = Math.floor((now || Date.now()) / DAY) + (store && store.logs ? store.logs.length : 0)
  return pool[Math.abs(n) % pool.length]
}

function voiceDir() {
  try { mkdirSync(VOICE_DIR, { recursive: true }) } catch {}
  return VOICE_DIR
}

// ---------- 参考音频（克隆用） ----------
function sampleDir() {
  try { mkdirSync(SAMPLE_DIR, { recursive: true }) } catch {}
  return SAMPLE_DIR
}

// 盘上还在的才算数：文件被删了就不列，免得选了却念不出来
function sampleList(v) {
  const out = []
  for (const x of (v && v.voices) || []) {
    if (!x || typeof x.id !== 'string') continue
    const p = join(sampleDir(), x.id + (x.ext || '.mp3'))
    try {
      const st = statSync(p)
      if (st.size > 0) out.push({ id: x.id, name: x.name || x.id, ext: x.ext || '.mp3', bytes: st.size, at: x.at || 0 })
    } catch {}
  }
  return out
}

// 裁到 30 秒、单声道 24k 转 mp3：原来动辄几 MB 的录音压成两三百 KB，每次克隆就不用背那么大的包
function trimSample(file, ext) {
  const ff = ffmpegPath()
  if (!ff) return { file, ext }
  const out = file.replace(/\.(mp3|wav)$/i, '') + '-cut.mp3'
  try {
    const r = spawnSync(ff, ['-y', '-v', 'error', '-i', file, '-t', '30', '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-q:a', '6', out], { windowsHide: true, timeout: 25000 })
    if (r.status === 0 && existsSync(out) && statSync(out).size > 1600) {
      try { unlinkSync(file) } catch {}
      return { file: out, ext: '.mp3' }
    }
  } catch {}
  try { if (existsSync(out)) unlinkSync(out) } catch {}
  return { file, ext }
}

function saveSample(v, payload) {
  const raw = String(payload.data || '')
  if (!raw) throw new Error('没有拿到音频数据')
  if (raw.length > MAX_SAMPLE_B64) throw new Error('这段录音太大了（' + (raw.length / 1048576).toFixed(1) + ' MB base64），换一段 30 秒以内的')
  const ext = String(payload.ext || '').toLowerCase() === '.wav' ? '.wav' : '.mp3'
  const buf = Buffer.from(raw, 'base64')
  if (buf.length < 1600) throw new Error('这个文件太小了，不像是语音')
  const id = createHash('sha1').update(buf).digest('hex').slice(0, 12)
  const dir = sampleDir()
  const name = String(payload.name || '我的音色').replace(/[\\/:*?"<>|\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24) || '我的音色'
  const list = Array.isArray(v.voices) ? v.voices.slice() : []
  const hit = list.find((x) => x && x.id === id)
  if (hit) return { entry: { ...hit, name }, added: false }
  if (list.length >= MAX_SAMPLES) throw new Error('最多存 ' + MAX_SAMPLES + ' 段参考音频，先删掉一段')
  const tmp = join(dir, 'in-' + id + ext)
  writeFileSync(tmp, buf)
  const kept = trimSample(tmp, ext)
  const final = join(dir, id + kept.ext)
  try { renameSync(kept.file, final) } catch { writeFileSync(final, readFileSync(kept.file)); try { unlinkSync(kept.file) } catch {} }
  const entry = { id, name, ext: kept.ext, bytes: statSync(final).size, at: Date.now() }
  list.push(entry)
  v.voices = list
  return { entry, added: true }
}

function delSample(v, id) {
  const key = String(id || '')
  const before = Array.isArray(v.voices) ? v.voices : []
  v.voices = before.filter((x) => x && x.id !== key)
  for (const e of ['.mp3', '.wav']) { try { unlinkSync(join(sampleDir(), key + e)) } catch {} }
  // 删的正是当前在用的那段：退回内置音色，别留一个念不出来的选择
  if (v.mimo && String(v.mimo.voice) === 'clone:' + key) v.mimo = { ...v.mimo, voice: 'mimo_default', model: 'mimo-v2.5-tts' }
  return { removed: before.length - v.voices.length }
}

// 克隆用的是「参考音频的 data URL」，MiMo 每次请求都得带上（服务端不存音色）
function cloneArg(v, id) {
  const entry = ((v && v.voices) || []).find((x) => x && x.id === String(id))
  if (!entry) throw new Error('这个参考音频找不到了，重新选一次文件')
  const p = join(sampleDir(), entry.id + (entry.ext || '.mp3'))
  let buf
  try { buf = readFileSync(p) } catch { throw new Error('参考音频读不出来：' + (entry.name || entry.id)) }
  if (buf.length * 1.37 > 10 * 1024 * 1024) throw new Error('参考音频太大（MiMo 上限 10 MB base64），换一段短一点的')
  const mime = (entry.ext || '.mp3') === '.wav' ? 'audio/wav' : 'audio/mpeg'
  return { url: 'data:' + mime + ';base64,' + buf.toString('base64'), bytes: buf.length, name: entry.name }
}

function cacheKey(v, text) {
  let src
  if (v.provider === 'local') src = ['local', v.local.shape, v.local.baseUrl, v.local.apiName, v.local.voicePath, text]
  else if (v.provider === 'mimo') src = ['mimo', v.mimo.baseUrl, v.mimo.model, v.mimo.voice, text]
  else src = ['cloud', v.cloud.baseUrl, v.cloud.model, v.cloud.voice, text]
  return createHash('sha1').update(JSON.stringify(src)).digest('hex').slice(0, 16)
}

function findCached(dir, key) {
  for (const e of ['.mp3', '.wav']) {
    const p = join(dir, key + e)
    try { if (existsSync(p) && statSync(p).size > 800) return p } catch {}
  }
  return ''
}

function cacheStat() {
  try {
    const dir = voiceDir()
    const files = readdirSync(dir).map((f) => {
      try { const st = statSync(join(dir, f)); return { f, size: st.size, mt: st.mtimeMs } } catch { return null }
    }).filter(Boolean).sort((a, b) => b.mt - a.mt)
    for (const x of files.slice(MAX_CACHE_FILES)) { try { unlinkSync(join(dir, x.f)) } catch {} }
    const keep = files.slice(0, MAX_CACHE_FILES)
    return { count: keep.length, bytes: keep.reduce((n, x) => n + x.size, 0) }
  } catch { return { count: 0, bytes: 0 } }
}

// OpenAI 兼容的 /audio/speech（云端各家基本都照这个形状，本地 GPT-SoVITS 之类也常见）
async function synthOpenAI(text, cfg) {
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '')
  if (!base) throw new Error('还没填合成服务地址')
  const fmt = cfg.format === 'wav' ? 'wav' : 'mp3'
  const headers = { 'content-type': 'application/json' }
  if (cfg.apiKey) headers.authorization = 'Bearer ' + cfg.apiKey
  const r = await fetch(base + '/audio/speech', {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: cfg.model || 'tts-1', voice: cfg.voice || 'alloy', input: text, response_format: fmt }),
    signal: AbortSignal.timeout(30000),
  })
  if (!r.ok) throw new Error('合成服务 ' + r.status + ' ' + String(await r.text()).slice(0, 160))
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length < 800) throw new Error('合成结果太小，当成失败')
  return { buf, ext: '.' + fmt }
}

// 小米 MiMo：不是 /audio/speech，走 chat/completions，音频在 choices[0].message.audio.data（base64）
// 要念的文字必须放在 assistant 消息里；voice 用内置音色名，或者 clone:<id> 走参考音频克隆
async function synthMimo(text, cfg, v) {
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '')
  if (!base) throw new Error('还没填 MiMo 服务地址')
  const fmt = cfg.format === 'wav' ? 'wav' : 'mp3'
  const headers = { 'content-type': 'application/json' }
  if (cfg.apiKey) { headers.authorization = 'Bearer ' + cfg.apiKey; headers['api-key'] = cfg.apiKey }
  let model = cfg.model || 'mimo-v2.5-tts'
  let voice = cfg.voice || 'mimo_default'
  if (/^clone:/.test(String(voice))) {
    const c = cloneArg(v, String(voice).slice(6))
    voice = c.url
    model = 'mimo-v2.5-tts-voiceclone'
  }
  const body = {
    model,
    messages: [{ role: 'assistant', content: text }],
    audio: { format: fmt, voice },
    stream: false,
  }
  const r = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  })
  if (!r.ok) throw new Error('MiMo ' + r.status + ' ' + String(await r.text()).slice(0, 160))
  const j = await r.json().catch(() => null)
  const node = j && j.choices && j.choices[0] && j.choices[0].message
  const b64 = node && node.audio && node.audio.data
  if (!b64) {
    const hint = node && node.content ? String(node.content).slice(0, 80) : '响应里没有 audio.data'
    throw new Error('MiMo 没返回音频：' + hint)
  }
  const buf = Buffer.from(String(b64), 'base64')
  if (buf.length < 800) throw new Error('合成结果太小，当成失败')
  return { buf, ext: '.' + fmt }
}

// 三路合成统一入口
function synthFor(v, text) {
  if (v.provider === 'mimo') return synthMimo(text, v.mimo, v)
  if (v.provider === 'local') return v.local.shape === 'openai' ? synthOpenAI(text, v.local) : synthGradio(text, v.local)
  return synthOpenAI(text, v.cloud)
}

function findAudioUrl(node, base, depth = 0) {
  if (depth > 6 || node == null) return ''
  if (typeof node === 'string') {
    if (/^https?:\/\//i.test(node) && /\.(wav|mp3|ogg|flac|m4a)(\?|$)/i.test(node)) return node
    if (/\.(wav|mp3|ogg|flac|m4a)$/i.test(node) && node.length < 400) return base + '/gradio_api/file=' + encodeURI(node)
    return ''
  }
  if (Array.isArray(node)) {
    for (const x of node) { const u = findAudioUrl(x, base, depth + 1); if (u) return u }
    return ''
  }
  if (typeof node === 'object') {
    if (typeof node.url === 'string') { const u = findAudioUrl(node.url, base, depth + 1); if (u) return u }
    for (const k of Object.keys(node)) { const u = findAudioUrl(node[k], base, depth + 1); if (u) return u }
  }
  return ''
}

// 本地 IndexTTS（Gradio WebUI）：接口名 + 参数模板，模板里 {{text}} / {{voice}} 会被替换
async function synthGradio(text, cfg) {
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '')
  const api = String(cfg.apiName || 'gen_single').trim()
  if (!base) throw new Error('还没填 IndexTTS 地址')
  let data
  const tpl = String(cfg.payload || '').trim()
  if (tpl) {
    const body = tpl
      .replace(/\{\{text\}\}/g, () => JSON.stringify(text).slice(1, -1))
      .replace(/\{\{voice\}\}/g, () => JSON.stringify(cfg.voicePath || '').slice(1, -1))
    let parsed
    try { parsed = JSON.parse(body) } catch { throw new Error('参数模板不是合法 JSON') }
    data = Array.isArray(parsed) ? parsed : (parsed.data || [])
  } else {
    data = [text, cfg.voicePath || '']
  }
  const call = await fetch(base + '/gradio_api/call/' + encodeURIComponent(api), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data }),
    signal: AbortSignal.timeout(20000),
  })
  if (!call.ok) throw new Error('IndexTTS ' + call.status + ' ' + String(await call.text()).slice(0, 160))
  const { event_id: eventId } = await call.json()
  if (!eventId) throw new Error('IndexTTS 没给出任务号，看看接口名对不对')
  const ev = await fetch(base + '/gradio_api/call/' + encodeURIComponent(api) + '/' + eventId, { signal: AbortSignal.timeout(120000) })
  if (!ev.ok) throw new Error('IndexTTS 取结果 ' + ev.status)
  const raw = await ev.text()
  let last = null
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t.startsWith('data:')) continue
    const payload = t.slice(5).trim()
    if (!payload || payload === 'null') continue
    try { last = JSON.parse(payload) } catch {}
  }
  const url = findAudioUrl(last, base)
  if (!url) throw new Error('IndexTTS 没返回音频，检查参数模板')
  const audio = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!audio.ok) throw new Error('取音频 ' + audio.status)
  const buf = Buffer.from(await audio.arrayBuffer())
  if (buf.length < 800) throw new Error('音频太小，当成失败')
  const ext = /\.wav(\?|$)/i.test(url) ? '.wav' : '.mp3'
  return { buf, ext }
}

const FFPLAY_HINTS = [
  process.env.FFPLAY_PATH,
  'ffplay',
  'D:\\100 SoftWare\\110 BasicSoftware\\ffmpeg-8.1.1-essentials_build\\bin\\ffplay.exe',
]

function ffplayPath() {
  for (const p of FFPLAY_HINTS) {
    if (!p || p === 'ffplay') continue
    try { if (existsSync(p)) return p } catch {}
  }
  return ''
}

// ffmpeg 通常和 ffplay 放在一起，用它量一小段音频的响度
function ffmpegPath() {
  const ff = ffplayPath()
  if (!ff) return ''
  const guess = join(dirname(ff), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  try { if (existsSync(guess)) return guess } catch {}
  return ''
}

// 末尾连续静音多少毫秒（10ms 一格，低于 -45dB 算静音）。
// MiMo 合成出来的句子常常一直响到文件结束——听起来就是最后一个字只读了半截；
// 正常的收尾应该有 40ms 以上的自然衰减。拿不到数（没有 ffmpeg）返回 null。
function tailQuiet(file) {
  return new Promise((resolve) => {
    const ff = ffmpegPath()
    if (!ff) { resolve(null); return }
    let err = ''
    const p = spawn(ff, ['-v', 'info', '-sseof', '-1.0', '-i', file,
      '-af', 'asetnsamples=n=441,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level',
      '-f', 'null', '-'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    p.stderr.on('data', (d) => { if (err.length < 200000) err += d })
    p.on('error', () => resolve(null))
    p.on('close', () => {
      const env = [...err.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map((m) => (m[1] === '-inf' ? -120 : Number(m[1])))
      if (!env.length) { resolve(null); return }
      let i = env.length - 1
      while (i >= 0 && env[i] < -45) i--
      resolve(Math.max(0, (env.length - 1 - i) * 10))
    })
    setTimeout(() => { try { p.kill() } catch {} }, 8000).unref?.()
  })
}

// 真的往文件尾部补一段静音（不是播放时加滤镜——ffplay 的 -autoexit 读到文件尾
// 就关声卡，滤镜补的尾巴它也来不及放）。补进文件里以后，最后一个字就完整了。
function padTail(file, ext) {
  return new Promise((resolve) => {
    const ff = ffmpegPath()
    if (!ff) { resolve(file); return }
    const out = file.replace(/\.[^.]+$/, '') + '-pad' + ext
    const codec = ext === '.wav' ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'libmp3lame', '-q:a', '5']
    const p = spawn(ff, ['-y', '-v', 'error', '-i', file, '-af', 'apad=pad_dur=0.45', ...codec, out], {
      windowsHide: true,
      stdio: 'ignore',
    })
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      if (ok) { try { if (statSync(out).size > 800) { try { unlinkSync(file) } catch {}; resolve(out); return } } catch {} }
      try { unlinkSync(out) } catch {}
      resolve(file)
    }
    p.on('error', () => finish(false))
    p.on('close', (code) => finish(code === 0))
    setTimeout(() => { try { p.kill() } catch {}; finish(false) }, 15000).unref?.()
  })
}

// 合成一条并挑收尾最干净的：同一条重合成会不一样，最多试 4 次，够 40ms 就收手，否则留最好那版。
// 每一条都先补上 0.45 秒静音再量——补过之后收尾天然干净，重合成基本用不上。
async function synthClean(v, text, dir) {
  const tries = 4
  let best = null
  for (let i = 0; i < tries; i++) {
    const r = await synthFor(v, text)
    let tmp = join(dir, 'tmp-' + Date.now() + '-' + i + r.ext)
    writeFileSync(tmp, r.buf)
    tmp = await padTail(tmp, r.ext)
    const q = await tailQuiet(tmp)
    const score = q == null ? 999 : q
    if (!best || score > best.score) {
      if (best) { try { unlinkSync(best.tmp) } catch {} }
      best = { tmp, ext: r.ext, score }
    } else {
      try { unlinkSync(tmp) } catch {}
    }
    if (q == null || q >= 40) break
  }
  return best
}

let playing = null
let queue = Promise.resolve()
const tailOk = new Set() // 这个进程里确认过尾巴干净的文件，别每次播放都再量一遍

// 一条一条念，不叠着响：新的一条排在后面，不打断正在念的（打断就会把最后一个字切掉）
function playFile(file) {
  return new Promise((resolve) => {
    const ff = ffplayPath()
    if (!ff) { resolve(new Error('没找到 ffplay')); return }
    const child = spawn(ff, ['-nodisp', '-autoexit', '-loglevel', 'quiet', file], { windowsHide: true, stdio: 'ignore' })
    playing = child
    const done = () => { if (playing === child) playing = null; resolve() }
    child.on('close', done)
    child.on('error', done)
  })
}

function startPlay(file) {
  const ff = ffplayPath()
  if (!ff) throw new Error('没找到 ffplay：装个 ffmpeg，或者把 ffplay 放进 PATH')
  queue = queue.then(() => playFile(file)).catch(() => {})
  return queue
}

// 记一条失败：带上发生时间，界面上好判断这是不是刚才那次
function markVoiceError(v, e, at) {
  v.lastError = String((e && e.message) || e).slice(0, 200)
  v.lastErrorAt = +at || Date.now()
  return v
}

// 备好这一条的音频，但不播（后台预热和到点播放都走这里）。
// 命中缓存先量收尾：老文件没补过静音、尾巴不干净的，重合成一份盖掉。
async function ensureAudio(v, text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300)
  if (!clean) throw new Error('没有可念的内容')
  const dir = voiceDir()
  const key = cacheKey(v, clean)
  let file = findCached(dir, key)
  const cached = !!file
  if (file && !tailOk.has(file)) {
    const q = await tailQuiet(file)
    if (q != null && q < 120) {
      try { unlinkSync(file) } catch {}
      file = ''
    } else {
      tailOk.add(file)
    }
  }
  if (!file) {
    const pick = await synthClean(v, clean, dir)
    file = join(dir, key + pick.ext)
    try { renameSync(pick.tmp, file) } catch { writeFileSync(file, readFileSync(pick.tmp)); try { unlinkSync(pick.tmp) } catch {} }
    tailOk.add(file)
  }
  cacheStat()
  return { file, cached, text: clean }
}

async function speakNow(v, text) {
  const r = await ensureAudio(v, text)
  startPlay(r.file)
  return r
}

// ---------- 提醒推算 ----------
// 同一类事最近一次完成的时间
function lastLogOf(s, kind, before = Date.now()) {
  let best = 0
  for (const l of s.logs) if (l.kind === kind && l.at <= before && l.at > best) best = l.at
  return best
}

function inQuiet(s, t) {
  const q = s.prefs.quiet || {}
  const a = minutesOf(q.from), b = minutesOf(q.to)
  if (a == null || b == null) return false
  const d = new Date(t), m = d.getHours() * 60 + d.getMinutes()
  return a <= b ? m >= a && m < b : m >= a || m < b
}

// 这条规则下一次该响的时间（毫秒），没有就返回 0
function nextAt(rule, s, now) {
  if (!rule || rule.enabled === false) return 0
  const today = startOfDay(now)
  // 喝水和起身按「在电脑前坐了多久」算，不按钟点
  if (rule.kind === 'water' && rule.mode === 'interval') {
    const a = readAct(s)
    const from = minutesOf(rule.from) ?? 540, to = minutesOf(rule.to) ?? 1260
    const d = new Date(now), mins = d.getHours() * 60 + d.getMinutes()
    if (mins < from) return stampOf(today, from)
    if (mins >= to) return stampOf(today + DAY, from)
    const every = Math.max(15, rule.everyMin || 90) * 60000
    return now + Math.max(1000, every - (a.waterMs || 0))
  }
  if (rule.id === 'stand') {
    const a = readAct(s)
    if (!a.seatStart) return 0
    return a.seatStart + Math.max(15, Math.min(180, rule.afterMin || SIT_AFTER_MIN)) * 60000
  }
  if (rule.mode === 'fixed') {
    let best = 0
    for (const t of rule.times || []) {
      const m = minutesOf(t)
      if (m == null) continue
      for (let k = 0; k < 2; k++) {
        const at = stampOf(today + k * DAY, m)
        if (at <= now + 1000) continue
        if (!best || at < best) best = at
      }
    }
    return best
  }
  if (rule.mode === 'interval') {
    const from = minutesOf(rule.from) ?? 540, to = minutesOf(rule.to) ?? 1260
    const every = Math.max(15, rule.everyMin || 90) * 60000
    const last = lastLogOf(s, rule.kind, now)
    let base = last || stampOf(today, from)
    // 今天已经超过窗口，就从明天开始
    if (!last && now < stampOf(today, from)) base = stampOf(today, from) - every
    let next = base + every
    if (next <= now) next = now + 1000 > next && last ? base + every : next
    for (let i = 0; i < 40 && next <= now; i++) next += every
    const d = new Date(next)
    const mins = d.getHours() * 60 + d.getMinutes()
    if (mins > to) { const nd = new Date(startOfDay(next) + DAY); nd.setHours(Math.floor(from / 60), from % 60, 0, 0); next = nd.getTime() }
    if (mins < from) { const nd = new Date(next); nd.setHours(Math.floor(from / 60), from % 60, 0, 0); next = nd.getTime() }
    return next
  }
  if (rule.mode === 'gap') {
    const last = lastLogOf(s, rule.kind, now)
    const gapMs = Math.max(1, rule.minGapDays || 3) * DAY
    const at = minutesOf(rule.at) ?? 1290
    let due = last ? startOfDay(last + gapMs) : startOfDay(now)
    let atToday = stampOf(due, at)
    if (atToday <= now) {
      if (!last) return 0
      if (atToday + DAY > now) return atToday + DAY
      return atToday + DAY
    }
    return atToday
  }
  return 0
}

function fireKey(ruleId, at) { return ruleId + '@' + ymd(new Date(at)) + ' ' + hhmm(new Date(at)) }

function tick(s, now) {
  const created = []
  for (const rule of s.rules) {
    // 喝水、起身由活动状态驱动，用「累计坐着的时长」判，不走钟点
    const actKey = actDue(rule, s, now)
    if (actKey !== null) {
      if (!actKey) continue
      if (inQuiet(s, now) && rule.kind !== 'sleep') continue
      if (s.fired[actKey]) continue
      s.fired[actKey] = now
      const actBody = bodyFor(rule, s, now)
      s.alarms.push({ id: 'a' + now.toString(36) + Math.random().toString(36).slice(2, 5), ruleId: rule.id, kind: rule.kind, title: rule.title, body: actBody, at: now, firedAt: now, seenAt: 0 })
      created.push({ title: rule.title, body: actBody })
      continue
    }
    const at = nextAt(rule, s, now)
    if (!at || at > now) continue
    if (inQuiet(s, now) && rule.kind !== 'sleep') continue
    const k = fireKey(rule.id, at)
    if (s.fired[k]) continue
    s.fired[k] = now
    const body = bodyFor(rule, s, now)
    s.alarms.push({ id: 'a' + now.toString(36) + Math.random().toString(36).slice(2, 5), ruleId: rule.id, kind: rule.kind, title: rule.title, body, at, firedAt: now, seenAt: 0 })
    created.push({ title: rule.title, body })
  }
  // 待办与日程：到点（日程按 leadMin 提前）也要提醒；不睡免打扰，因为本来就是你排在那个点的
  const lead = Math.max(0, Math.min(60, Math.round(Number(readVoice(s).leadMin) || 0))) * 60000
  for (const it of s.plans || []) {
    if (!it || !isFinite(+it.at)) continue
    const fireAt = it.type === 'event' ? +it.at - lead : +it.at
    if (now < fireAt) continue
    if (now - fireAt > 30 * 60000) continue
    const k = 'p' + it.id + '@' + fireAt
    if (s.fired[k]) continue
    s.fired[k] = now
    const title = String(it.title || (it.type === 'event' ? '日程' : '待办')).slice(0, 60)
    const body = it.type === 'event'
      ? `${hhmm(new Date(+it.at))} 开始，${lead ? '还有 ' + lead / 60000 + ' 分钟' : '现在该开始了'}`
      : `${hhmm(new Date(+it.at))} 到点，该做了`
    s.alarms.push({ id: 'a' + now.toString(36) + Math.random().toString(36).slice(2, 5), ruleId: 'plan:' + it.id, srcId: it.id, kind: it.type === 'event' ? 'event' : 'todo', title, body, at: fireAt, planAt: +it.at, firedAt: now, seenAt: 0 })
    created.push({ title, body })
  }
  if (s.alarms.length > 60) s.alarms = s.alarms.slice(-60)
  // 清掉太老的 fired 记录
  const keys = Object.keys(s.fired)
  if (keys.length > 400) {
    const keep = {}
    keys.slice(-300).forEach((k) => { keep[k] = s.fired[k] })
    s.fired = keep
  }
  return created
}

function bodyFor(rule, s, now) {
  if (rule.id === 'stand') {
    const a = readAct(s)
    const mins = a.seatStart ? Math.max(1, Math.round((now - a.seatStart) / 60000)) : 0
    return mins ? `坐 ${mins} 分钟了，起来走两步` : '起来走两步'
  }
  if (rule.kind === 'water') {
    const last = lastLogOf(s, rule.kind, now)
    if (!last) return '今天还没喝水，先来一杯（约 250 ml）'
    const seatMin = Math.round((readAct(s).waterMs || 0) / 60000)
    const cups = s.logs.filter((l) => l.kind === 'water' && l.at >= startOfDay(now)).length
    return seatMin ? `在电脑前坐了 ${seatMin} 分钟没喝水，今天第 ${cups + 1} 杯` : `今天第 ${cups + 1} 杯`
  }
  if (rule.kind === 'hair') {
    const last = lastLogOf(s, rule.kind, now)
    if (!last) return '还没记过洗头，今天洗一次？'
    return `距上次洗头 ${Math.floor((now - last) / DAY)} 天`
  }
  if (rule.kind === 'shower') return '洗个澡，今天到这儿了'
  if (rule.kind === 'meal') return '到饭点了，吃完顺手记一笔'
  if (rule.kind === 'sleep') return '放下手机，明天还要干活'
  return '该做这件事了'
}

// ---------- 模型 ----------
function makeAsk(ctx, getAI) {
  async function pickModel(strong) {
    const pick = (typeof getAI === 'function' ? getAI() : null) || {}
    const providers = ctx.llm.listProviders()
    // 用户自己指定了模型就照他指定的来，只在这个模型不存在时才回落到自动挑
    if (pick.model) {
      let provider = pick.provider
      if (!provider) {
        for (const p of providers) {
          try {
            const ms = await ctx.llm.listModels(p.id)
            if (ms.some((m) => m.id === pick.model)) { provider = p.id; break }
          } catch {}
        }
      }
      if (provider) return { provider, model: pick.model }
    }
    const sel = ctx.get?.('agentDefaultModel')?.currentSelection?.()
    let provider = sel?.provider, model = sel?.model
    if (!provider) provider = providers[0]?.id
    if (!provider) throw new Error('DSH 里还没有可用的模型，请先在设置里添加')
    try {
      const models = await ctx.llm.listModels(provider)
      if (!strong) {
        const fast = models.find((m) => /flash|chat|lite|mini|turbo|v3/i.test(m.id) && !/reason|r1|think|pro/i.test(m.id))
        if (fast) model = fast.id
      }
      if (!model) model = models[0]?.id
    } catch {}
    if (!model) throw new Error('DSH 里还没有可用的模型，请先在设置里添加')
    return { provider, model }
  }

  return async function ask(system, user, { signal, maxTokens = AI_MAX_TOKENS, strong = false } = {}) {
    const route = await pickModel(strong)
    const info = await ctx.llm.resolveModelInfo?.(route.provider, route.model).catch(() => undefined)
    const efforts = info?.reasoning?.efforts ?? []
    const effort = efforts.some((e) => e.id === 'off') ? 'off' : efforts.at(0)?.id
    // 模型自己声明了输出上限就按它压一下，别拿 128K 去撞 400
    const declared = Number(info?.limits?.maxOutputTokens || info?.maxOutputTokens || 0)
    let budget = declared > 0 ? Math.min(maxTokens, declared) : maxTokens
    let lastErr = null
    for (let round = 0; round < 3; round++) {
      let text = '', finish
      const kinds = {}
      try {
        for await (const chunk of ctx.llm.stream({
          provider: route.provider,
          model: route.model,
          ...(effort === undefined ? {} : { reasoningEffort: effort }),
          system,
          messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
          maxTokens: budget,
          signal,
        })) {
          const kind = String(chunk?.type || '?')
          kinds[kind] = (kinds[kind] || 0) + 1
          if (kind === 'finish') { finish = chunk.reason; continue }
          // 不同 host 版本对增量文本的字段名不完全一致，几种常见形状都接一下，别因为读错字段就当模型没说话
          const piece = chunk?.text ?? chunk?.delta ?? chunk?.content?.text ?? chunk?.value ?? (typeof chunk?.delta === 'string' ? chunk.delta : undefined)
          if (kind !== 'reasoning-delta' && typeof piece === 'string' && piece) text += piece
        }
      } catch (e) {
        const msg = String(e?.message || e)
        // 上限给太大被闸掉的（400 / 参数非法），降一档再来，别把整次排程一起废掉
        if (budget > 4096 && /max.?tokens?|too (large|long)|invalid|400|exceed/i.test(msg)) {
          budget = Math.max(4096, Math.floor(budget / 4))
          lastErr = e
          continue
        }
        throw e
      }
      if (finish && (finish.kind === 'error' || finish.kind === 'aborted')) {
        const msg = finish.failure?.message || '模型调用失败'
        if (budget > 4096 && /max.?tokens?|too (large|long)|invalid|exceed/i.test(msg)) {
          budget = Math.max(4096, Math.floor(budget / 4))
          lastErr = new Error(msg)
          continue
        }
        if (/max.?token|length/i.test(msg)) throw new Error('这次事情太多，一次排不下，分两段说试试')
        throw new Error(msg)
      }
      return { text, model: route.model, kinds, budget }
    }
    throw lastErr || new Error('模型调用失败')
  }
}

// 解析一句话
function parsePrompt(p) {
  const lines = [`现在：${p.now || ''}`, `用户体重：约 ${p.weightKg || 68} kg`]
  const mine = p.mine && Object.keys(p.mine).length ? Object.entries(p.mine).slice(0, 60).map(([k, v]) => `${k} 每份 ${v} 千卡`).join('；') : ''
  if (mine) lines.push(`用户亲自改过的热量（以此为准）：${mine}`)
  lines.push(`这句话：${String(p.text || '').slice(0, 300)}`)
  return lines.join('\n')
}

// 排程上下文
function planPrompt(p) {
  const L = []
  L.push(`现在：${p.now}`)
  L.push(`要安排的那天：${p.date}${p.weekday ? '（周' + p.weekday + '）' : ''}`)
  if (p.profile) L.push(`他是谁：${p.profile}`)
  if (p.lastNight) L.push(`昨晚睡了 ${p.lastNight} 小时`)
  if (p.goals) L.push(`目标：每天 ${p.goals.kcal || '—'} 千卡、睡 ${p.goals.sleep || '—'} 小时、每周练 ${p.goals.workoutsPerWeek || '—'} 次`)
  if (p.weather) L.push(`天气：${p.weather}`)
  L.push('那天已经有的安排（不能动，也不能贴太近）：')
  if (Array.isArray(p.busy) && p.busy.length) p.busy.forEach((b) => L.push(`- ${b.start}–${b.end} ${b.title}`))
  else L.push('- 无')
  if (Array.isArray(p.todos) && p.todos.length) {
    L.push('还没做的事（有时间的就排进去，没时间的挑重要的排）：')
    p.todos.slice(0, 12).forEach((t) => L.push(`- ${t.title}${t.amount ? '（' + t.amount + ' 元）' : ''}`))
  }
  if (p.routineLine) L.push(`他的固定习惯：${p.routineLine}`)
  if (p.constraint) L.push(`他这次补充的要求：${String(p.constraint).slice(0, 200)}`)
  L.push(`他说的话：${String(p.text || '').slice(0, 400)}`)
  return L.join('\n')
}

function coachPrompt(p) {
  const L = [`现在：${p.now}`]
  if (p.name) L.push(`称呼：${p.name}`)
  L.push(`今天：吃了 ${p.kcalIn || 0} 千卡（目标 ${p.kcal || '—'}），花了 ${p.spent || 0} 元（预算 ${p.budget || '—'}），练了 ${p.moveMin || 0} 分钟`)
  if (p.lastNight) L.push(`昨晚睡了 ${p.lastNight} 小时`)
  if (p.water != null) L.push(`今天喝了 ${p.water} 次水`)
  if (p.hairDays != null) L.push(`距上次洗头 ${p.hairDays} 天`)
  if (p.nextEvent) L.push(`接下来：${p.nextEvent}`)
  if (p.todoLeft != null) L.push(`还有 ${p.todoLeft} 件事没做`)
  if (p.weather) L.push(`天气：${p.weather}`)
  return L.join('\n')
}

// ---------- 排程结果规整 ----------
// 模型偶尔还是会排出半夜的块、和已有日程撞车的块。这里按「人看之前」的硬规矩再过一遍。
function tidyPlan(raw, dateStr, busy) {
  const day0 = new Date(dateStr + 'T00:00:00').getTime()
  const taken = []
  for (const b of Array.isArray(busy) ? busy : []) {
    const s = minutesOf(b?.start), e = minutesOf(b?.end)
    if (s != null && e != null && e > s) taken.push([s, e])
  }
  const list = []
  for (const b of Array.isArray(raw?.blocks) ? raw.blocks : []) {
    const s = minutesOf(b?.start), e = minutesOf(b?.end)
    if (s == null || e == null || e <= s) continue
    // 只在 06:00–23:30 之间，单块不超过 3 小时
    if (s < 6 * 60 || e > 23 * 60 + 30 || e - s > 180) continue
    list.push({ s, e, b })
  }
  list.sort((x, y) => x.s - y.s)
  const out = []
  for (const { s, e, b } of list) {
    if (out.length >= 14) break
    if (taken.some(([bs, be]) => s < be && e > bs)) continue
    taken.push([s, e])
    out.push({
      start: b.start, end: b.end, title: String(b.title || '').slice(0, 30),
      domain: ['admin', 'work', 'life', 'move', 'rest'].includes(b.domain) ? b.domain : 'work',
      why: String(b.why || '').slice(0, 60), remind: b.remind !== false,
      t: day0 + s * 60000, endT: day0 + e * 60000,
    })
  }
  return { date: dateStr, summary: String(raw?.summary || '').slice(0, 80), blocks: out, notes: (raw?.notes || []).slice(0, 2).map((x) => String(x).slice(0, 80)), question: String(raw?.question || '').slice(0, 120) }
}

// ---------- 插件本体 ----------
export function apply(ctx) {
  const ask = makeAsk(ctx, () => readStore().ai)
  let store = readStore()
  let timer = null

  const save = () => writeStore(store)

  // ===== 活动采样：小程序随宿主启停，宿主一关它自己就退 =====
  const watch = { child: null, tries: 0, retry: null, off: false }

  function startWatch() {
    if (watch.off || watch.child) return
    const exe = idlewatchPath()
    if (!exe) {
      store.act = { ...readAct(store), helper: 'missing' }
      return
    }
    let child = null
    try {
      child = spawn(exe, ['-parent', String(process.pid), '-every', String(ACT_EVERY_S)], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      })
    } catch {
      store.act = { ...readAct(store), helper: 'fail' }
      return
    }
    watch.child = child
    // 采样器不该把宿主吊住：DSH 该退就退，管道一断它自己收工
    try { child.unref(); child.stdout.unref?.(); child.stdin.unref?.() } catch {}
    store.act = { ...readAct(store), helper: 'ok' }
    let buf = ''
    child.stdout.on('data', (chunk) => {
      buf += String(chunk)
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        try {
          const j = JSON.parse(line)
          if (!isFinite(+j.idle)) continue
          feedSample(store, +j.t || Date.now(), Math.max(0, +j.idle))
          save()
        } catch {}
      }
    })
    child.on('exit', () => {
      watch.child = null
      if (watch.off) return
      store.act = { ...readAct(store), helper: watch.tries >= 3 ? 'fail' : 'down' }
      save()
      if (watch.tries >= 3) return
      watch.tries += 1
      clearTimeout(watch.retry)
      watch.retry = setTimeout(startWatch, 60000)
      if (typeof watch.retry.unref === 'function') watch.retry.unref()
    })
  }

  function stopWatch() {
    watch.off = true
    clearTimeout(watch.retry)
    try { if (watch.child) { watch.child.stdin.end(); watch.child.kill() } } catch {}
    watch.child = null
  }

  // 到点念：先把音频备好再播。还没备好的那一小会儿，界面显示「处理中」
  let saying = null
  const warm = { busy: false }
  let tickCount = 0

  function sayAlarm(alarmId, v, text) {
    const clean = String(text || '')
    saying = { id: alarmId || '', text: clean, preparing: true, since: Date.now() }
    return ensureAudio(v, clean)
      .then((r) => {
        saying = { id: alarmId || '', text: r.text, preparing: false, since: Date.now() }
        startPlay(r.file)
        v.lastAt = Date.now()
        v.lastError = ''
        v.lastErrorAt = 0
        store.voice = v
        save()
      })
      .catch((e) => {
        saying = null
        markVoiceError(v, e, Date.now())
        store.voice = v
        save()
      })
  }

  // 后台把今天会用到的台词先合成好，到点就有现成的
  async function warmRun(jobs) {
    if (warm.busy) return
    warm.busy = true
    try {
      const v = readVoice(store)
      if (!v.enabled) return
      for (const text of jobs) {
        const clean = String(text || '').trim()
        if (!clean) continue
        if (findCached(voiceDir(), cacheKey(v, clean))) continue
        try {
          await ensureAudio(v, clean)
        } catch (e) {
          markVoiceError(v, e, Date.now())
          store.voice = v
          save()
          return
        }
      }
    } finally { warm.busy = false }
  }

  function warmUpcoming() {
    if (warm.busy) return
    const now = Date.now()
    const v = readVoice(store)
    if (!v.enabled) return
    const jobs = []
    for (const r of store.rules) {
      if (!r || r.enabled === false) continue
      if (v.read[r.kind] === false || v.groups.routine === false) continue
      jobs.push(phraseFor(store, r.kind, now))
    }
    for (const g of ['todo', 'event']) {
      if (v.groups[g] === false) continue
      jobs.push(phraseFor(store, g, now))
    }
    if (jobs.length) warmRun(jobs)
  }

  function runTick() {
    try {
      const now = Date.now()
      const created = tick(store, now)
      if (created.length) {
        save()
        const quietClient = !store.seenAt || now - store.seenAt > 90000
        if (quietClient && store.prefs.system !== false) {
          const one = created[0]
          notify(one.title, created.length > 1 ? `${one.body}（另有 ${created.length - 1} 条）` : one.body)
        }
        // 到点念一句：生活琐事在免打扰时段不念；待办和日程照念
        const v = readVoice(store)
        const last = store.alarms[store.alarms.length - 1]
        if (v.enabled && last && v.read[last.kind] !== false) {
          const grp = last.kind === 'todo' ? 'todo' : last.kind === 'event' ? 'event' : 'routine'
          const quietBlocked = grp === 'routine' && inQuiet(store, now)
          if (!quietBlocked && v.groups[grp] !== false) {
            const said = grp === 'routine'
              ? phraseFor(store, last.kind, now)
              : String(last.title || '').slice(0, 60) + '，' + phraseFor(store, grp, now)
            sayAlarm(last.id, v, said)
          }
        }
      }
      // 每两分钟看一眼今天要念的台词备齐了没（已在缓存里的直接跳过，不重复合成）
      if (++tickCount % 8 === 0) warmUpcoming()
    } catch (e) { console.warn('[dsh-rigui-pro] 提醒轮询出错', e && e.message) }
  }

  ctx.effect(() => {
    timer = setInterval(runTick, 15000)
    if (typeof timer.unref === 'function') timer.unref()
    setTimeout(runTick, 2500)
    const boot = setTimeout(startWatch, 1500)
    if (typeof boot.unref === 'function') boot.unref()
    const firstWarm = setTimeout(warmUpcoming, 4000)
    if (typeof firstWarm.unref === 'function') firstWarm.unref()
    return () => {
      if (timer) clearInterval(timer)
      clearTimeout(boot)
      clearTimeout(firstWarm)
      stopWatch()
    }
  }, 'dsh-rigui-pro: 提醒调度与活动采样')

  function statePayload(now) {
    const due = store.alarms.filter((a) => !a.seenAt && a.at <= now + 1000)
    const next = store.rules.map((r) => ({ id: r.id, kind: r.kind, title: r.title, at: nextAt(r, store, now) })).filter((r) => r.at)
    const lead = Math.max(0, Math.min(60, Math.round(Number(readVoice(store).leadMin) || 0))) * 60000
    for (const it of store.plans || []) {
      if (!isFinite(+it.at)) continue
      const fireAt = it.type === 'event' ? +it.at - lead : +it.at
      if (fireAt <= now || fireAt > now + DAY) continue
      next.push({ id: 'plan:' + it.id, kind: it.type === 'event' ? 'event' : 'todo', title: it.title, at: fireAt })
    }
    next.sort((a, b) => a.at - b.at)
    return {
      now,
      rules: store.rules,
      due: due.map((a) => ({ id: a.id, ruleId: a.ruleId, srcId: a.srcId || '', kind: a.kind, title: a.title, body: a.body, at: a.at })),
      next: next.slice(0, 6),
      today: {},
      ai: store.ai || { provider: '', model: '' },
      voice: readVoice(store),
      speaking: saying ? { id: saying.id, text: saying.text, preparing: !!saying.preparing, since: saying.since } : null,
      activity: actView(store, now),
    }
  }

  const api = async (body, signal) => {
    const p = body.payload || {}
    const now = Date.now()

    if (body.endpoint === 'ping') return { ok: true, result: { name, store: STORE_FILE } }

    if (body.endpoint === 'weather' || body.endpoint === 'geo') {
      const url = body.endpoint === 'geo'
        ? 'https://geocoding-api.open-meteo.com/v1/search?count=1&language=zh&name=' + encodeURIComponent(String(p.name || '').slice(0, 40))
        : 'https://api.open-meteo.com/v1/forecast?current=temperature_2m,apparent_temperature,weather_code,is_day,relative_humidity_2m,wind_speed_10m&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&timezone=auto&forecast_days=7&latitude=' + Number(p.lat) + '&longitude=' + Number(p.lon)
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (!r.ok) throw new Error('天气服务 ' + r.status)
      return { ok: true, result: await r.json() }
    }

    if (body.endpoint === 'parse') {
      const r = await ask(PARSE_SYSTEM, parsePrompt(p), { signal, maxTokens: AI_MAX_TOKENS })
      return { ok: true, model: r.model, result: extractJSON(r.text) }
    }

    if (body.endpoint === 'plan' || body.endpoint === 'replan') {
      const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(String(p.date || '')) ? p.date : ymd(new Date())
      const prompt = planPrompt({ ...p, date: dateStr })
      // 先用平时那个强一点的模型；它要是没给出 JSON（有的模型会先写一段人话、或者把预算全花在思考上），
      // 就换快模型再排一次——排程这事不能因为模型脾气就停在「还没排出来」。
      let last = { plan: null, model: '', text: '', err: '', kinds: {} }
      for (const strong of [true, false]) {
        const r = await ask(PLAN_SYSTEM, prompt, { signal, maxTokens: AI_MAX_TOKENS, strong })
        try {
          const plan = tidyPlan(extractJSON(r.text), dateStr, p.busy)
          if (plan.blocks.length) return { ok: true, model: r.model, result: plan }
          last = { plan, model: r.model, text: r.text, err: '', kinds: r.kinds }
        } catch (e) {
          last = { plan: null, model: r.model, text: r.text, err: String(e.message || e), kinds: r.kinds }
        }
        planDebug({ at: now, model: last.model, strong, text: last.text, error: last.err, kinds: last.kinds })
      }
      if (last.plan) return { ok: true, model: last.model, result: last.plan }
      const seen = String(last.text || '').replace(/\s+/g, ' ').trim().slice(0, 120)
      const shape = Object.entries(last.kinds || {}).map(([k, n]) => k + '×' + n).join(' ')
      throw new Error(
        '模型没有给出可用的结果' +
          (last.err ? '：' + last.err : '') +
          (seen ? '｜它说的是：' + seen : '｜它一个字也没回' + (shape ? '（收到的片段：' + shape + '）' : '')),
      )
    }

    if (body.endpoint === 'coach') {
      const r = await ask(COACH_SYSTEM, coachPrompt(p), { signal, maxTokens: AI_MAX_TOKENS })
      const j = extractJSON(r.text)
      return { ok: true, model: r.model, result: { lines: (j.lines || []).filter((x) => typeof x === 'string').slice(0, 2) } }
    }

    // ---- 用哪个模型 ----
    if (body.endpoint === 'ai') {
      const action = p.action || 'get'
      if (action === 'list') {
        const providers = []
        for (const pv of ctx.llm.listProviders()) {
          let ms = []
          try { ms = (await ctx.llm.listModels(pv.id)) || [] } catch {}
          providers.push({ id: pv.id, name: pv.name || pv.id, models: ms.map((m) => ({ id: m.id, name: m.name || m.id })) })
        }
        const sel = ctx.get?.('agentDefaultModel')?.currentSelection?.() || {}
        return { ok: true, result: { providers, pick: store.ai || { provider: '', model: '' }, auto: { provider: sel.provider || '', model: sel.model || '' } } }
      }
      if (action === 'set') {
        const model = String(p.model || '').slice(0, 120)
        store.ai = { provider: model ? String(p.provider || '').slice(0, 60) : '', model }
        save()
        return { ok: true, result: { pick: store.ai } }
      }
      return { ok: true, result: { pick: store.ai || { provider: '', model: '' } } }
    }

    // ---- 在不在电脑前 ----
    if (body.endpoint === 'activity') {
      const action = p.action || 'state'
      if (action === 'sample') {
        // 冒烟与调试用：把一次采样直接喂进状态机，不用真跑小程序
        feedSample(store, Number(p.at) || now, Math.max(0, Number(p.idle) || 0))
        save()
        runTick()
        return { ok: true, result: actView(store, Date.now()) }
      }
      if (action === 'restart') {
        watch.tries = 0
        stopWatch()
        watch.off = false
        startWatch()
        return { ok: true, result: actView(store, Date.now()) }
      }
      return { ok: true, result: { ...actView(store, now), helperPath: idlewatchPath() } }
    }

    // ---- 规律与提醒 ----
    if (body.endpoint === 'routine') {
      const action = p.action || 'state'
      if (action === 'state') {
        store.seenAt = now
        save()
        return { ok: true, result: statePayload(now) }
      }
      if (action === 'rules') {
        const rules = Array.isArray(p.rules) ? p.rules.slice(0, 24) : null
        if (rules) {
          store.rules = rules.map((r) => ({
            id: String(r.id || '').slice(0, 24) || 'r' + Math.random().toString(36).slice(2, 6),
            kind: String(r.kind || 'custom').slice(0, 16),
            title: String(r.title || '提醒').slice(0, 24),
            mode: ['fixed', 'interval', 'gap', 'sit'].includes(r.mode) ? r.mode : 'fixed',
            times: Array.isArray(r.times) ? r.times.slice(0, 4).map((t) => String(t).slice(0, 5)) : undefined,
            everyMin: r.everyMin ? Math.max(15, Math.min(720, +r.everyMin)) : undefined,
            from: r.from ? String(r.from).slice(0, 5) : undefined,
            to: r.to ? String(r.to).slice(0, 5) : undefined,
            minGapDays: r.minGapDays ? Math.max(1, Math.min(60, +r.minGapDays)) : undefined,
            at: r.at ? String(r.at).slice(0, 5) : undefined,
            afterMin: r.afterMin ? Math.max(15, Math.min(180, +r.afterMin)) : undefined,
            per: r.per ? +r.per : undefined,
            enabled: r.enabled !== false,
          }))
          // 起身是这一版新加的：老客户端推上来的规则里没有它，别让它被覆盖没了
          if (!store.rules.some((r) => r.id === 'stand')) {
            const def = DEFAULT_RULES.find((r) => r.id === 'stand')
            if (def) store.rules.push({ ...def })
          }
          save()
          warmUpcoming()
        }
        return { ok: true, result: statePayload(now) }
      }
      if (action === 'plans') {
        const items = Array.isArray(p.items) ? p.items.slice(0, 400) : []
        store.plans = items
          .filter((x) => x && x.title && isFinite(+x.at) && +x.at > now - 3600000)
          .map((x) => ({
            id: String(x.id || '').slice(0, 48) || 'p' + Math.random().toString(36).slice(2, 8),
            type: x.type === 'event' ? 'event' : 'todo',
            title: String(x.title).slice(0, 60),
            at: +x.at,
          }))
          .slice(0, 300)
        save()
        return { ok: true, result: statePayload(now) }
      }
      if (action === 'log') {
        const kind = String(p.kind || '').slice(0, 16)
        if (kind) {
          store.logs.push({ id: 'l' + now.toString(36) + Math.random().toString(36).slice(2, 4), kind, at: Number(p.at) || now, amount: p.amount ? +p.amount : null })
          if (store.logs.length > 800) store.logs = store.logs.slice(-800)
          // 真喝了一杯，喝水计时从现在重新起算（计时只算人在电脑前的时间）
          if (kind === 'water') store.act = { ...readAct(store), waterMs: 0 }
          // 记了就算这轮提醒已经处理
          store.alarms.forEach((a) => { if (!a.seenAt && a.kind === kind) a.seenAt = now })
          save()
          runTick()
        }
        return { ok: true, result: statePayload(now) }
      }
      if (action === 'undo') {
        // 点错了撤回来：把这一类最近的一条记录挪掉，提醒节奏跟着回退
        const kind = String(p.kind || '').slice(0, 16)
        let removed = null
        if (kind) {
          for (let i = store.logs.length - 1; i >= 0; i--) {
            if (store.logs[i].kind === kind) { removed = store.logs.splice(i, 1)[0]; break }
          }
          if (removed) { save(); runTick() }
        }
        return { ok: true, removed, result: statePayload(now) }
      }
      if (action === 'logs') {
        if (Array.isArray(p.logs)) {
          for (const l of p.logs.slice(-60)) {
            if (!l || !l.kind || !l.at) continue
            if (!store.logs.some((x) => x.kind === l.kind && Math.abs(x.at - l.at) < 60000)) store.logs.push({ id: l.id || 'l' + l.at.toString(36), kind: String(l.kind).slice(0, 16), at: +l.at, amount: l.amount ? +l.amount : null })
          }
          if (store.logs.length > 800) store.logs = store.logs.slice(-800)
          save()
        }
        return { ok: true, result: statePayload(now) }
      }
      if (action === 'ack') {
        const ids = Array.isArray(p.ids) ? p.ids : [p.id]
        store.alarms.forEach((a) => { if (ids.includes(a.id) && !a.seenAt) a.seenAt = now })
        save()
        return { ok: true, result: statePayload(now) }
      }
      if (action === 'snooze') {
        const mins = Math.max(1, Math.min(180, +p.minutes || 15))
        const ids = Array.isArray(p.ids) ? p.ids : [p.id]
        store.alarms.forEach((a) => { if (ids.includes(a.id)) a.seenAt = now })
        const src = store.alarms.find((a) => ids.includes(a.id))
        if (src) store.alarms.push({ ...src, id: 's' + now.toString(36), at: now + mins * 60000, firedAt: now, seenAt: 0, title: src.title })
        save()
        return { ok: true, result: statePayload(now) }
      }
      return { ok: false, error: '未知的 routine 动作' }
    }

    // ---- 语音 ----
    if (body.endpoint === 'voice') {
      const v = readVoice(store)
      const action = p.action || 'get'
      if (action === 'get') {
        const sp = saying ? { id: saying.id, text: saying.text, preparing: !!saying.preparing, since: saying.since } : null
        return { ok: true, result: { voice: v, defaults: defaultLines(), ffplay: !!ffplayPath(), cache: cacheStat(), playing: !!playing, speaking: sp, voices: sampleList(v), maxSample: MAX_SAMPLE_B64 } }
      }
      if (action === 'set') {
        const next = mergeVoice(v, p.voice)
        // 换了配置就把上一次的错误清掉：那条多半是对着旧配置报的，留着只会让人以为还没修好
        next.lastError = ''
        next.lastErrorAt = 0
        store.voice = next
        save()
        warmUpcoming() // 换了配置，缓存全作废，后台重新备一遍
        return { ok: true, result: { voice: next, defaults: defaultLines(), ffplay: !!ffplayPath(), cache: cacheStat(), voices: sampleList(next) } }
      }
      // 存一段参考音频：选一次文件，之后选中它就一直带
      if (action === 'addvoice') {
        try {
          const got = saveSample(v, p)
          store.voice = v
          save()
          warmUpcoming()
          return { ok: true, result: { saved: got.entry, added: got.added, voice: v, voices: sampleList(v) } }
        } catch (e) {
          return { ok: false, error: String((e && e.message) || e) }
        }
      }
      if (action === 'delvoice') {
        const r = delSample(v, p.id)
        store.voice = v
        save()
        warmUpcoming()
        return { ok: true, result: { removed: r.removed, voice: v, voices: sampleList(v) } }
      }
      // 试听这段参考音频本身，确认录的是想要的那把嗓子
      if (action === 'probevoice') {
        const e = sampleList(v).find((x) => x.id === String(p.id || ''))
        if (!e) return { ok: false, error: '这段参考音频不在了' }
        startPlay(join(sampleDir(), e.id + e.ext))
        return { ok: true, result: { playing: e.name, file: join(sampleDir(), e.id + e.ext) } }
      }
      if (action === 'say' || action === 'test') {
        const kind = String(p.kind || '').slice(0, 16)
        const text = String(p.text || '').slice(0, 300) || (kind ? phraseFor(store, kind, now) : '') || '语音试听，一二三。'
        try {
          const r = await speakNow(v, text)
          v.lastAt = now
          v.lastError = ''
          v.lastErrorAt = 0
          store.voice = v
          save()
          return { ok: true, result: { played: true, text: r.text, cached: r.cached, file: r.file } }
        } catch (e) {
          markVoiceError(v, e, now)
          store.voice = v
          save()
          return { ok: false, error: v.lastError, errorAt: v.lastErrorAt }
        }
      }
      if (action === 'stop') {
        try { if (playing) playing.kill() } catch {}
        playing = null
        saying = null
        queue = Promise.resolve() // 队列里排着的也一起作废
        return { ok: true, result: { stopped: true } }
      }
      return { ok: false, error: '未知的 voice 动作' }
    }

    return { ok: false, error: '未知接口' }
  }

  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let body = {}
      try { body = await request.json() } catch {}
      // 排程要吐一整天的块，给它更长的等待时间；其它接口还是 45 秒
      const isPlan = body && (body.endpoint === 'plan' || body.endpoint === 'replan')
      const timeout = AbortSignal.timeout(isPlan ? PLAN_TIMEOUT_MS : AI_TIMEOUT_MS)
      const signal = request.signal && AbortSignal.any ? AbortSignal.any([request.signal, timeout]) : timeout
      try {
        return json(await api(body, signal))
      } catch (error) {
        const msg = error?.name === 'TimeoutError' ? '等太久了，再说一次' : String(error?.message || error)
        return json({ ok: false, error: msg })
      }
    },
  }), 'dsh-rigui-pro: api route')
}
