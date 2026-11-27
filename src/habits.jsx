// 日晷 Pro · 日常琐事
// 一张卡管住「喝水、吃饭、洗澡、洗头、睡觉」：今天做了几次、上一次是几点、下一次什么时候提醒。
// 点一下就记下，不做二次确认；记完提醒自动往后顺延。
// 每件事旁边一个小喇叭：点一下当场念这句（试听），同时决定这件事要不要念。
import React, { useMemo, useState } from 'react'
import { ROUTINE, routineName, fmtHM, pad2 } from './habits.js'

const CSS = `
.rh-chips{display:flex;flex-wrap:wrap;gap:8px}
.rh-item{display:inline-flex;align-items:center;gap:5px}
.rh-chip{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 12px;border-radius:11px;border:1px solid var(--rule,rgba(31,35,40,.12));background:transparent;color:inherit;font:inherit;font-size:13.5px;cursor:pointer;transition:transform .12s ease,background .12s ease}
.rh-chip:hover{background:rgba(31,35,40,.05)}
.rh-chip:active{transform:scale(.97)}
.rh-chip.done{border-color:transparent;background:rgba(30,158,106,.14)}
.rh-chip i{width:8px;height:8px;border-radius:50%;display:block}
.rh-chip b{font-weight:600;font-variant-numeric:tabular-nums}
.rh-say{width:27px;height:27px;flex:none;border-radius:9px;border:1px solid var(--rule,rgba(31,35,40,.12));background:transparent;color:inherit;font:inherit;font-size:12px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:background .12s ease,opacity .12s ease}
.rh-say:hover{background:rgba(31,35,40,.06)}
.rh-say.on{border-color:rgba(30,158,106,.42);background:rgba(30,158,106,.13)}
.rh-say.dim{opacity:.42}
.rh-cups{display:flex;align-items:flex-end;gap:5px;height:44px;margin:10px 0 4px}
.rh-cup{width:11px;border-radius:3px 3px 1px 1px;background:var(--rule,rgba(31,35,40,.12));transition:background .25s ease,height .25s ease}
.rh-cup.on{background:#3B82C4}
.rh-line{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12.5px;color:var(--ink2,#6B7280);margin-top:8px}
.rh-next{display:flex;align-items:center;gap:6px}
.rh-dot{width:6px;height:6px;border-radius:50%;background:#1E9E6A;flex:none;animation:rh-blink 2s ease-in-out infinite}
@keyframes rh-blink{0%,100%{opacity:.35}50%{opacity:1}}
.rh-rules{display:flex;flex-direction:column;gap:2px}
.rh-rule{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--rule,rgba(31,35,40,.07))}
.rh-rule:last-child{border-bottom:0}
.rh-rule .n{flex:1;font-size:13.5px}
.rh-rule .t{font-size:12px;color:var(--ink2,#6B7280);font-variant-numeric:tabular-nums}
.rh-step{width:24px;height:24px;border-radius:8px;border:1px solid var(--rule,rgba(31,35,40,.14));background:transparent;color:inherit;font:inherit;line-height:1;cursor:pointer;font-size:14px}
.rh-sw{width:38px;height:22px;border-radius:11px;border:0;background:var(--rule,rgba(31,35,40,.16));position:relative;cursor:pointer;flex:none;transition:background .18s ease}
.rh-sw.on{background:#1E9E6A}
.rh-sw::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:8px;background:#fff;transition:transform .18s cubic-bezier(.2,.8,.2,1)}
.rh-sw.on::after{transform:translateX(16px)}
.rh-v{display:flex;flex-direction:column;gap:7px;margin-top:6px}
.rh-vrow{display:flex;align-items:center;gap:8px}
.rh-vrow .n{width:74px;flex:none;font-size:12.5px;color:var(--ink2,#6B7280)}
.rh-in{flex:1;min-width:0;height:30px;padding:0 9px;border-radius:8px;border:1px solid var(--rule,rgba(31,35,40,.16));background:transparent;color:inherit;font:inherit;font-size:12.5px}
.rh-seg{display:inline-flex;border:1px solid var(--rule,rgba(31,35,40,.14));border-radius:9px;overflow:hidden}
.rh-seg button{height:26px;padding:0 10px;border:0;background:transparent;color:inherit;font:inherit;font-size:12.5px;cursor:pointer}
.rh-seg button.on{background:rgba(242,153,74,.2);font-weight:600}
.rh-go{height:30px;padding:0 13px;border-radius:9px;border:0;background:#1F2328;color:#F4F5F1;font:inherit;font-size:12.5px;cursor:pointer}
.rh-go.ghost{background:rgba(31,35,40,.07);color:inherit}
.rh-note{font-size:12px;color:var(--ink2,#6B7280);line-height:1.6;margin-top:6px}
.rh-sub{font-size:12.5px;font-weight:600;margin:16px 0 6px}
.rh-stack{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:30;display:flex;flex-direction:column;gap:10px;width:min(430px,calc(100vw - 32px))}
.rh-toast{background:#1F2328;color:#F4F5F1;border-radius:18px;padding:14px 16px;box-shadow:0 18px 44px rgba(16,20,24,.34);animation:rh-rise .32s cubic-bezier(.2,.8,.2,1) both}
@keyframes rh-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.rh-toast .h{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600}
.rh-toast .b{margin-top:3px;font-size:13px;line-height:1.55;color:rgba(244,245,241,.72)}
.rh-toast .a{display:flex;gap:8px;margin-top:11px}
.rh-toast .a button{height:32px;padding:0 13px;border-radius:9px;border:0;font:inherit;font-size:13px;cursor:pointer;background:rgba(255,255,255,.13);color:#F4F5F1}
.rh-toast .a button.main{background:#F2994A;color:#1F2328;font-weight:600}
`

const drop = (color, size = 8) => <i style={{ background: color }} aria-hidden="true" />

// 一件事 + 旁边那个小喇叭（点一下：念这句，并把它设成要念）
function Chip({ kind, voice, onSay, onLog, done, title, children }) {
  const on = !(voice && voice.read && voice.read[kind] === false)
  return (
    <span className="rh-item">
      <button type="button" className={'rh-chip' + (done ? ' done' : '')} onClick={() => onLog(kind)} title={title}>
        {children}
      </button>
      <button
        type="button"
        className={'rh-say' + (on ? ' on' : ' dim')}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSay(kind) }}
        title={on ? '念一句试试；再点一次就不念这件事' : '这件事不念；点一下开始念'}
        aria-label={on ? routineName(kind) + '要念，点一下取消' : routineName(kind) + '不念，点一下开启'}
        aria-pressed={on}
      >{on ? '🔊' : '🔈'}</button>
    </span>
  )
}

export function RoutineCard({ ctx }) {
  const { S, rules, onLog, next, voice, onSay } = ctx
  const water = (S.routines && S.routines.today && S.routines.today.water) || { count: 0, ml: 0, lastAt: 0 }
  const shower = (S.routines && S.routines.today && S.routines.today.shower) || null
  const hair = (S.routines && S.routines.last && S.routines.last.hair) || null
  const hairDays = hair ? Math.floor((S.now - hair.t) / 86400000) : null
  const cups = 8
  const filled = Math.min(cups, Math.round(water.ml / 250) || water.count)
  const soon = useMemo(() => (next || []).filter((n) => n.at > S.now).sort((a, b) => a.at - b.at)[0], [next, S.now])
  const hairRule = (rules || []).find((r) => r.id === 'hair')

  return (
    <>
      <style>{CSS}</style>
      <div className="lf-row" style={{ justifyContent: 'space-between', marginBottom: 2 }}>
        <h2 className="lf-h">日常</h2>
        <span className="lf-sub">{water.ml ? water.ml + ' ml' : water.count ? water.count + ' 次' : '还没记'}</span>
      </div>
      <div className="rh-cups" aria-hidden="true">
        {Array.from({ length: cups }, (_, i) => (
          <span key={i} className={'rh-cup' + (i < filled ? ' on' : '')} style={{ height: 12 + i * 4 }} />
        ))}
      </div>
      <div className="rh-chips">
        <Chip kind="water" voice={voice} onSay={onSay} onLog={onLog} done={!!water.count} title="记一杯水">
          {drop('#3B82C4')}喝水 {water.count ? <b>{water.count} 次</b> : null}
        </Chip>
        <Chip kind="shower" voice={voice} onSay={onSay} onLog={onLog} done={!!shower} title="记一次洗澡">
          {drop('#3D4FB8')}洗澡
        </Chip>
        <Chip kind="hair" voice={voice} onSay={onSay} onLog={onLog} done={hairDays != null && hairRule && hairDays < (hairRule.minGapDays || 3)} title="记一次洗头">
          {drop('#7C5CE0')}洗头{hairDays != null ? <b>{hairDays} 天前</b> : null}
        </Chip>
      </div>
      <div className="rh-line">
        <span className="rh-next">
          {soon ? <><span className="rh-dot" />{fmtHM(soon.at)} {soon.title}</> : <span>今天的都过了</span>}
        </span>
        {water.lastAt ? <span>{fmtHM(water.lastAt)} 喝过</span> : null}
      </div>
      <p className="rh-note">喇叭亮着就会念；点一下先听，再点一下就这件事不念。</p>
    </>
  )
}

const READ_KINDS = ['water', 'shower', 'hair', 'meal', 'sleep']

export function BackRoutine({ rules, onToggle, onEvery, onGap, voice, onVoice, onTest, onSaved }) {
  const v = voice || {}
  const [d, setD] = useState(() => ({ cloud: { ...(v.cloud || {}) }, local: { ...(v.local || {}) } }))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const on = !!v.enabled
  const provider = v.provider === 'local' ? 'local' : 'cloud'
  const setField = (group, f, val) => setD((x) => ({ ...x, [group]: { ...x[group], [f]: val } }))

  const save = async () => {
    setBusy(true)
    try {
      const r = await onVoice({ enabled: on, provider, cloud: d.cloud, local: d.local })
      setMsg(r ? '存好了' : '存的时候出了点问题')
      if (onSaved) onSaved()
    } finally { setBusy(false) }
  }

  return (
    <>
      <style>{CSS}</style>
      <h2 className="lf-h" style={{ marginBottom: 8 }}>提醒怎么设</h2>
      <div className="rh-rules">
        {(rules || []).map((r) => (
          <div className="rh-rule" key={r.id}>
            <span className="n">{r.title}</span>
            {r.mode === 'interval' ? (
              <span className="lf-row" style={{ gap: 4 }}>
                <button type="button" className="rh-step" onClick={() => onEvery(r.id, -15)} aria-label="少十五分钟">−</button>
                <span className="t">{r.everyMin} 分钟</span>
                <button type="button" className="rh-step" onClick={() => onEvery(r.id, 15)} aria-label="多十五分钟">+</button>
              </span>
            ) : r.mode === 'gap' ? (
              <span className="lf-row" style={{ gap: 4 }}>
                <button type="button" className="rh-step" onClick={() => onGap(r.id, -1)} aria-label="少一天">−</button>
                <span className="t">{r.minGapDays} 天</span>
                <button type="button" className="rh-step" onClick={() => onGap(r.id, 1)} aria-label="多一天">+</button>
              </span>
            ) : (
              <span className="t">{(r.times || []).join(' · ')}</span>
            )}
            <button type="button" className={'rh-sw' + (r.enabled !== false ? ' on' : '')} onClick={() => onToggle(r.id)} aria-label={r.enabled !== false ? '关掉' : '打开'} aria-pressed={r.enabled !== false} />
          </div>
        ))}
      </div>
      <p className="rh-note">点一下就记下，记完自动顺延；面板关着也会弹系统提醒。</p>

      <div className="rh-sub">念出来</div>
      <div className="rh-vrow">
        <span className="n">到点念</span>
        <button type="button" className={'rh-sw' + (on ? ' on' : '')} onClick={() => onVoice({ enabled: !on })} aria-pressed={on} aria-label={on ? '关掉语音' : '打开语音'} />
        <span style={{ flex: 1 }} />
        <span className="rh-seg">
          <button type="button" className={provider === 'cloud' ? 'on' : ''} onClick={() => onVoice({ provider: 'cloud' })}>云端</button>
          <button type="button" className={provider === 'local' ? 'on' : ''} onClick={() => onVoice({ provider: 'local' })}>本地</button>
        </span>
      </div>

      {provider === 'cloud' ? (
        <div className="rh-v">
          <div className="rh-vrow"><span className="n">地址</span><input className="rh-in" value={d.cloud.baseUrl || ''} onChange={(e) => setField('cloud', 'baseUrl', e.target.value)} placeholder="https://api.openai.com/v1" /></div>
          <div className="rh-vrow"><span className="n">密钥</span><input className="rh-in" value={d.cloud.apiKey || ''} onChange={(e) => setField('cloud', 'apiKey', e.target.value)} placeholder="sk-…（明文存在本机）" /></div>
          <div className="rh-vrow"><span className="n">模型</span><input className="rh-in" value={d.cloud.model || ''} onChange={(e) => setField('cloud', 'model', e.target.value)} placeholder="gpt-4o-mini-tts / tts-1" /></div>
          <div className="rh-vrow"><span className="n">音色</span><input className="rh-in" value={d.cloud.voice || ''} onChange={(e) => setField('cloud', 'voice', e.target.value)} placeholder="alloy" /></div>
        </div>
      ) : (
        <div className="rh-v">
          <div className="rh-vrow">
            <span className="n">形态</span>
            <span className="rh-seg">
              <button type="button" className={(d.local.shape || 'gradio') === 'gradio' ? 'on' : ''} onClick={() => setField('local', 'shape', 'gradio')}>IndexTTS</button>
              <button type="button" className={d.local.shape === 'openai' ? 'on' : ''} onClick={() => setField('local', 'shape', 'openai')}>OpenAI 兼容</button>
            </span>
          </div>
          <div className="rh-vrow"><span className="n">服务地址</span><input className="rh-in" value={d.local.baseUrl || ''} onChange={(e) => setField('local', 'baseUrl', e.target.value)} placeholder="http://127.0.0.1:7860" /></div>
          {(d.local.shape || 'gradio') === 'gradio' ? (
            <>
              <div className="rh-vrow"><span className="n">接口名</span><input className="rh-in" value={d.local.apiName || ''} onChange={(e) => setField('local', 'apiName', e.target.value)} placeholder="gen_single" /></div>
              <div className="rh-vrow"><span className="n">参考音频</span><input className="rh-in" value={d.local.voicePath || ''} onChange={(e) => setField('local', 'voicePath', e.target.value)} placeholder="D:\\voices\\me.wav" /></div>
              <div className="rh-vrow"><span className="n">参数模板</span><input className="rh-in" value={d.local.payload || ''} onChange={(e) => setField('local', 'payload', e.target.value)} placeholder='留空就发 ["文案","参考音频"]' /></div>
            </>
          ) : (
            <>
              <div className="rh-vrow"><span className="n">模型</span><input className="rh-in" value={d.local.model || ''} onChange={(e) => setField('local', 'model', e.target.value)} placeholder="tts-1" /></div>
              <div className="rh-vrow"><span className="n">音色</span><input className="rh-in" value={d.local.voice || ''} onChange={(e) => setField('local', 'voice', e.target.value)} placeholder="zh-female" /></div>
            </>
          )}
          <p className="rh-note">本地就走 IndexTTS 的 Gradio 接口（接口名可在 {d.local.baseUrl || '服务'} 的 /gradio_api/info 里查）。</p>
        </div>
      )}

      <div className="rh-vrow" style={{ marginTop: 10 }}>
        <button type="button" className="rh-go" onClick={save} disabled={busy}>{busy ? '存…' : '保存'}</button>
        <button type="button" className="rh-go ghost" onClick={() => onTest && onTest()}>念一句试试</button>
      </div>
      {msg ? <p className="rh-note">{msg}</p> : null}

      <div className="rh-sub">哪几件要念</div>
      <div className="rh-v">
        {READ_KINDS.map((k) => {
          const rOn = !(v.read && v.read[k] === false)
          return (
            <div className="rh-vrow" key={k}>
              <span className="n">{routineName(k)}</span>
              <button type="button" className={'rh-sw' + (rOn ? ' on' : '')} onClick={() => onVoice({ read: { [k]: !rOn } })} aria-pressed={rOn} aria-label={routineName(k) + (rOn ? '要念' : '不念')} />
            </div>
          )
        })}
      </div>
      <p className="rh-note">
        播放器：{v.ffplay ? 'ffplay 可用' : '没找到 ffplay（非 wav 得装）'} · 缓存 {v.cache ? v.cache.count : 0} 条
        {v.lastError ? ' · 上次出错：' + v.lastError : ''}
      </p>
    </>
  )
}

export function ReminderStack({ items, onDone, onSnooze, onSkip }) {
  if (!items || !items.length) return null
  return (
    <>
      <style>{CSS}</style>
      <div className="rh-stack" role="status">
        {items.slice(0, 2).map((a) => (
          <div className="rh-toast" key={a.id}>
            <div className="h"><span style={{ width: 8, height: 8, borderRadius: 4, background: (ROUTINE[a.kind] || ROUTINE.custom).color }} />{a.title}</div>
            <div className="b">{a.body}</div>
            <div className="a">
              <button type="button" className="main" onClick={() => onDone(a)}>做了</button>
              <button type="button" onClick={() => onSnooze(a, 15)}>15 分钟后</button>
              <button type="button" onClick={() => onSkip(a)}>不用了</button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

export { routineName, fmtHM, pad2 }
