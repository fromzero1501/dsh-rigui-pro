// 日晷 Pro · 日常琐事
// 一张卡管住「喝水、吃饭、洗澡、洗头、睡觉」：今天做了几次、上一次是几点、下一次什么时候提醒。
// 点一下就记下，不做二次确认；记完提醒自动往后顺延。
// 每件事旁边一个小喇叭：点一下当场念这句（试听），同时决定这件事要不要念。
import React, { useMemo } from 'react'
import { ROUTINE, routineName, fmtHM, pad2 } from './habits.js'

const CSS = `
.rh-chips{display:flex;flex-wrap:wrap;gap:8px}
.rh-item{display:inline-flex;align-items:center;gap:5px}
.rh-chip{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 12px;border-radius:11px;border:1px solid var(--rule,rgba(31,35,40,.12));background:transparent;color:inherit;font:inherit;font-size:13.5px;cursor:pointer;transition:transform .12s ease,background .12s ease}
.rh-chip:hover{background:rgba(31,35,40,.05)}
.rh-chip:active{transform:scale(.97)}
.rh-chip.done{border-color:transparent;background:rgba(30,158,106,.14)}
.rh-chip.locked{cursor:default;opacity:.7}
.rh-chip.locked:hover{background:rgba(30,158,106,.14)}
.rh-chip[disabled]{pointer-events:none}
.rh-chip i{width:8px;height:8px;border-radius:50%;display:block}
.rh-chip b{font-weight:600;font-variant-numeric:tabular-nums}
.rh-say{width:27px;height:27px;flex:none;border-radius:9px;border:1px solid var(--rule,rgba(31,35,40,.12));background:transparent;color:inherit;font:inherit;font-size:12px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:background .12s ease,opacity .12s ease}
.rh-say:hover{background:rgba(31,35,40,.06)}
.rh-say.on{border-color:rgba(30,158,106,.42);background:rgba(30,158,106,.13)}
.rh-say.dim{opacity:.42}
.wh-wrap{display:flex;align-items:center;gap:14px;margin:10px 0 4px;flex:1;min-height:0}
.wh-glass{position:relative;width:64px;height:98px;flex:none;padding:0;border:2px solid rgba(59,130,196,.45);border-radius:7px 7px 18px 18px;background:rgba(59,130,196,.05);overflow:hidden;cursor:pointer;transition:transform .12s ease,border-color .2s ease}
.wh-glass:hover{border-color:rgba(59,130,196,.75)}
.wh-glass:active{transform:scale(.97)}
.wh-glass.full{cursor:default;border-color:rgba(59,130,196,.8)}
.wh-glass[disabled]{pointer-events:none}
.wh-water{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(to top,#3B82C4,#67A9DC);transition:height .45s cubic-bezier(.2,.8,.2,1)}
.wh-water::after{content:'';position:absolute;left:0;right:0;top:-3px;height:6px;border-radius:50%;background:rgba(255,255,255,.42)}
.wh-full{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:#0E5C8A;letter-spacing:.1em}
.wh-side{display:flex;flex-direction:column;gap:4px;min-width:0}
.wh-num{display:flex;align-items:baseline;gap:5px}
.wh-num b{font-size:34px;font-weight:500;line-height:1;font-variant-numeric:tabular-nums}
.wh-num span{font-size:12.5px;color:var(--ink2,#6B7280)}
.wh-ml{font-size:12.5px;color:var(--ink2,#6B7280);font-variant-numeric:tabular-nums}
.wh-last{font-size:12px;color:var(--ink3,#9AA0A6)}
.wh-btns{display:flex;align-items:center;gap:6px;margin-top:2px}
.wh-say{margin-top:0;align-self:auto}
.wh-minus{width:27px;height:27px;flex:none;border-radius:9px;border:1px solid var(--rule,rgba(31,35,40,.12));background:transparent;color:var(--ink2,#6B7280);font:inherit;font-size:15px;line-height:1;cursor:pointer;padding:0}
.wh-minus:disabled{opacity:.35;cursor:default}
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
.rh-note{font-size:12px;color:var(--ink2,#6B7280);line-height:1.6;margin:6px 0 0}
.rh-foot{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;margin-top:8px}
.rh-open{flex:none;height:28px;padding:0 11px;border-radius:9px;border:1px solid var(--rule,rgba(31,35,40,.14));background:transparent;color:inherit;font:inherit;font-size:12.5px;cursor:pointer;transition:background .12s ease}
.rh-open:hover{background:rgba(31,35,40,.06)}
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
function Chip({ kind, voice, onSay, onLog, done, locked, title, lockHint, children }) {
  const on = !(voice && voice.read && voice.read[kind] === false)
  return (
    <span className="rh-item">
      <button
        type="button"
        className={'rh-chip' + (done ? ' done' : '') + (locked ? ' locked' : '')}
        onClick={() => onLog(kind)}
        disabled={!!locked}
        aria-disabled={!!locked}
        title={locked ? title + (lockHint || '（今天已经记过了）') : title}
      >
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
  const lastOf = (k) => (S.routines && S.routines.last && S.routines.last[k]) || null
  const daysOf = (r) => (r ? Math.floor((S.now - r.t) / 86400000) : null)
  const showerLast = lastOf('shower'), hairLast = lastOf('hair')
  const showerDays = daysOf(showerLast), hairDays = daysOf(hairLast)
  const soon = useMemo(() => (next || []).filter((n) => n.at > S.now).sort((a, b) => a.at - b.at)[0], [next, S.now])
  const showerRule = (rules || []).find((r) => r.id === 'shower')
  const hairRule = (rules || []).find((r) => r.id === 'hair')
  const showerGap = (showerRule && showerRule.minGapDays) || 3
  const hairGap = (hairRule && hairRule.minGapDays) || 3
  // 洗澡洗头：洗完 3 天内不用再记（喝水已经单独一张卡了）
  const showerWait = showerDays != null && showerDays < showerGap
  const hairWait = hairDays != null && hairDays < hairGap

  return (
    <>
      <style>{CSS}</style>
      <div className="lf-row" style={{ justifyContent: 'space-between', marginBottom: 2 }}>
        <h2 className="lf-h">日常</h2>
        <span className="lf-sub">{showerDays != null ? '上次洗澡 ' + (showerDays === 0 ? '今天' : showerDays + ' 天前') : '还没记'}</span>
      </div>
      <div className="rh-chips" style={{ marginTop: 12 }}>
        <Chip kind="shower" voice={voice} onSay={onSay} onLog={onLog} done={showerWait} locked={showerWait} title={'记一次洗澡（洗一次管 ' + showerGap + ' 天）'} lockHint={'（还差 ' + (showerGap - showerDays) + ' 天）'}>
          {drop('#3D4FB8')}洗澡{showerDays != null ? <b>{showerDays === 0 ? '今天' : showerDays + ' 天前'}</b> : null}
        </Chip>
        <Chip kind="hair" voice={voice} onSay={onSay} onLog={onLog} done={hairWait} locked={hairWait} title={'记一次洗头（洗一次管 ' + hairGap + ' 天）'} lockHint={'（还差 ' + (hairGap - hairDays) + ' 天）'}>
          {drop('#7C5CE0')}洗头{hairDays != null ? <b>{hairDays === 0 ? '今天' : hairDays + ' 天前'}</b> : null}
        </Chip>
      </div>
      <div className="rh-line">
        <span className="rh-next">
          {soon ? <><span className="rh-dot" />{fmtHM(soon.at)} {soon.title}</> : <span>今天的都过了</span>}
        </span>
      </div>
      <div className="rh-foot">
        <p className="rh-note">喇叭亮着就会念；点一下先听，再点一下这件事就不念。洗澡洗头不满 3 天的按钮会灰掉；喝水在那张单独的杯子里记。</p>
      </div>
    </>
  )
}

// 喝水：一张卡就是一只杯子，点一次水位往上走一格，满 8 杯停在满格。
export function WaterCard({ ctx }) {
  const { S, onLog, onMinus, onSay, voice } = ctx
  const water = (S.routines && S.routines.today && S.routines.today.water) || { count: 0, ml: 0, lastAt: 0 }
  const cups = 8
  const got = Math.min(cups, Math.round((water.ml || 0) / 250) || water.count || 0)
  const full = got >= cups || (water.ml || 0) >= 2000
  const level = Math.round((Math.min(got, cups) / cups) * 100)
  const on = !(voice && voice.read && voice.read.water === false)
  return (
    <>
      <style>{CSS}</style>
      <div className="lf-row" style={{ justifyContent: 'space-between', marginBottom: 2 }}>
        <h2 className="lf-h">喝水</h2>
        <span className="lf-sub">{full ? '今天喝够了' : '点一下杯子加一杯'}</span>
      </div>
      <div className="wh-wrap">
        <button
          type="button"
          className={'wh-glass' + (full ? ' full' : '')}
          onClick={() => onLog('water')}
          disabled={full}
          aria-disabled={full}
          aria-label={full ? '今天八杯已经喝够了' : '喝了一杯水，当前 ' + got + ' 杯'}
          title={full ? '今天八杯已经喝够了' : '点一下，加一杯（250 ml）'}
        >
          <span className="wh-water" style={{ height: level + '%' }} aria-hidden="true" />
          {full ? <span className="wh-full">满</span> : null}
        </button>
        <div className="wh-side">
          <div className="wh-num"><b style={{ color: '#3B82C4' }}>{got}</b><span>/ {cups} 杯</span></div>
          <div className="wh-ml">{water.ml ? water.ml + ' ml' : '还没喝'}</div>
          <div className="wh-last">{water.lastAt ? fmtHM(water.lastAt) + ' 喝过' : '一杯 250 ml'}</div>
          <div className="wh-btns">
            <button
              type="button"
              className={'rh-say wh-say' + (on ? ' on' : ' dim')}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSay('water') }}
              title={on ? '念一句试试；再点一次就不念喝水' : '喝水不念；点一下开始念'}
              aria-label={on ? '喝水要念，点一下取消' : '喝水不念，点一下开启'}
              aria-pressed={on}
            >{on ? '🔊' : '🔈'}</button>
            <button
              type="button"
              className="wh-minus"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMinus() }}
              disabled={got === 0}
              aria-disabled={got === 0}
              aria-label="点错了，撤掉最后一杯水"
              title={got === 0 ? '今天还没记过，没有可撤的' : '点错了？撤掉最后一杯'}
            >−</button>
          </div>
        </div>
      </div>
    </>
  )
}

// 背面只剩提醒节奏；语音那套搬到独立面板（src/voice.jsx），入口在页面顶部。
export function BackRoutine({ rules, onToggle, onEvery, onGap }) {
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
      <p className="rh-note">点一下就记下，记完自动顺延；面板关着也会弹系统提醒。待办和日程到点同样会提醒。</p>
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
