// 日晷 Pro · 日常琐事
// 一张卡管住「喝水、吃饭、洗澡、洗头、睡觉」：今天做了几次、上一次是几点、下一次什么时候提醒。
// 点一下就记下，不做二次确认；记完提醒自动往后顺延。
// 每件事旁边一个小喇叭：点一下当场念这句（试听），同时决定这件事要不要念。
import React, { useMemo, useState, useEffect } from 'react'
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
.wh-side{display:flex;flex-direction:column;gap:4px;flex:1 1 auto;min-width:0}
.wh-num{display:flex;align-items:baseline;gap:5px}
.wh-num b{font-size:34px;font-weight:500;line-height:1;font-variant-numeric:tabular-nums}
.wh-num span{font-size:12.5px;color:var(--ink2,#6B7280)}
.wh-ml{font-size:12.5px;color:var(--ink2,#6B7280);font-variant-numeric:tabular-nums}
.wh-last{font-size:12px;color:var(--ink3,#9AA0A6)}
.wh-btns{display:flex;align-items:center;gap:6px;margin-top:2px}
.wh-say{margin-top:0;align-self:auto}
.wh-minus{width:27px;height:27px;flex:none;border-radius:9px;border:1px solid var(--rule,rgba(31,35,40,.12));background:transparent;color:var(--ink2,#6B7280);font:inherit;font-size:15px;line-height:1;cursor:pointer;padding:0}
.wh-minus:disabled{opacity:.35;cursor:default}
.md-zone{display:flex;align-items:center;gap:12px;margin-left:auto;flex:0 0 auto;min-width:0}
.md-pot{position:relative;flex:none;width:58px;height:98px;display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 1px 2px rgba(31,35,40,.05))}
.md-cap{width:32px;height:9px;border-radius:3px 3px 2px 2px;background:linear-gradient(to bottom,#F4F7FA,#D7DEE7);box-shadow:inset 0 -1px 0 rgba(31,35,40,.10);flex:none}
.md-body{position:relative;flex:1;width:100%;margin-top:2px;border:1.5px solid rgba(31,35,40,.16);border-radius:7px 7px 12px 12px;background:linear-gradient(to bottom,#FFFFFF,#F6F8FA);overflow:hidden;min-height:0;box-shadow:inset 0 1px 3px rgba(31,35,40,.05)}
.md-pot.empty .md-body{border-style:dashed;opacity:.55}
.md-slots{position:absolute;inset:4px}
.md-pill{position:absolute;width:15px;height:8px;border-radius:4px;box-sizing:border-box;background:linear-gradient(180deg,rgba(255,255,255,.20) 0%,rgba(255,255,255,0) 52%,rgba(31,35,40,.10) 100%),linear-gradient(90deg,color-mix(in srgb,var(--pc,#9AA1AA) 88%,#9AA5B1) 0 50%,#F1F5F9 50% 100%);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--pc,#9AA1AA) 42%,#B4C0CD),0 1px 1.5px rgba(31,35,40,.20);transform:translate(-50%,-50%) rotate(var(--rot,0deg));transition:opacity .24s ease,filter .24s ease;pointer-events:none}
.md-pill.on{opacity:0;filter:blur(.6px)}
.md-legend{display:flex;flex-direction:column;gap:1px;min-width:0}
.md-row{display:flex;align-items:center;gap:2px;min-width:0}
.md-take{display:flex;align-items:baseline;gap:6px;min-width:0;padding:3px 4px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.md-take:hover:enabled{background:rgba(59,130,196,.08)}
.md-take:disabled{cursor:default}
.md-name{max-width:64px;font-size:12.5px;font-weight:500;color:var(--ink,#1F2328);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.md-cnt{font-size:11px;font-weight:600;color:#9AA1AA;font-variant-numeric:tabular-nums}
.md-cnt.done{color:#1E9E6A}
.md-minus{flex:none;display:grid;place-items:center;width:18px;height:18px;padding:0;border:1px solid rgba(31,35,40,.14);border-radius:50%;background:#fff;color:#9AA1AA;font-size:12px;line-height:1;cursor:pointer}
.md-minus:hover:enabled{border-color:rgba(226,96,76,.6);background:rgba(226,96,76,.06);color:#E2604C}
.md-minus:disabled{opacity:.28;cursor:default}
.md-list{display:flex;flex-direction:column;gap:6px;margin-top:10px}
.md-edit{display:flex;align-items:center;gap:6px}
.md-input{flex:1;min-width:0;height:28px;padding:0 8px;border-radius:8px;border:1px solid var(--rule,rgba(31,35,40,.14));background:transparent;color:inherit;font:inherit;font-size:13px}
.md-input:focus-visible{outline:2px solid rgba(59,130,196,.45);outline-offset:1px}
.md-step{display:inline-flex;align-items:center;gap:4px;flex:none}
.md-step .t{font-size:12px;color:var(--ink2,#6B7280);font-variant-numeric:tabular-nums;min-width:28px;text-align:center}
.md-add{margin-top:8px;align-self:flex-start}
.rh-line{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12.5px;color:var(--ink2,#6B7280);margin-top:8px}
.rh-next{display:flex;align-items:center;gap:6px}
.rh-dot{width:6px;height:6px;border-radius:50%;background:#1E9E6A;flex:none;animation:rh-blink 2s ease-in-out infinite}
@keyframes rh-blink{0%,100%{opacity:.35}50%{opacity:1}}
.rh-rules{display:flex;flex-direction:column;gap:2px}
.rh-act{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--ink2,#6B7280);font-variant-numeric:tabular-nums;white-space:nowrap}
.rh-act i{width:7px;height:7px;border-radius:50%;background:#9AA0A6;flex:none}
.rh-act.focus{color:#1E9E6A}
.rh-act.focus i{background:#1E9E6A;box-shadow:0 0 0 3px rgba(30,158,106,.16);animation:rh-blink 2.2s ease-in-out infinite}
.rh-act.desk i{background:#3B82C4}
.rh-act.away{color:var(--ink3,#9AA0A6)}
.rh-act.away i{background:#C9CDD2}
.rh-act b{font-weight:600}
.rh-rule{display:grid;grid-template-columns:1fr auto;align-items:center;gap:2px 10px;padding:9px 0;border-bottom:1px solid var(--rule,rgba(31,35,40,.07))}
.rh-rule:last-child{border-bottom:0}
.rh-rule .n{font-size:13.5px}
.rh-rule .t{font-size:12px;color:var(--ink2,#6B7280);font-variant-numeric:tabular-nums}
.rh-ctl{grid-column:1/-1;display:flex;align-items:center;flex-wrap:wrap;gap:5px}
.rh-time{height:26px;padding:0 3px;border-radius:8px;border:1px solid var(--rule,rgba(31,35,40,.14));background:transparent;color:inherit;font:inherit;font-size:12px;font-variant-numeric:tabular-nums;cursor:pointer;min-width:80px}
.rh-time:hover{background:rgba(31,35,40,.05)}
.rh-time:focus-visible{outline:2px solid rgba(59,130,196,.45);outline-offset:1px}
.rh-timewrap{display:inline-flex;align-items:center;gap:2px}
.rh-winline{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--ink2,#6B7280)}
.rh-drop{width:20px;height:20px;flex:none;border-radius:6px;border:0;background:transparent;color:var(--ink3,#9AA0A6);font:inherit;font-size:12px;line-height:1;cursor:pointer;padding:0}
.rh-drop:hover{background:rgba(155,28,32,.1);color:var(--warn-ink,#9B1C20)}
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
.rh-prep{align-self:center;display:flex;align-items:center;gap:7px;font-size:12px;color:#3F4A55;background:rgba(255,255,255,.94);border:1px solid rgba(0,0,0,.07);border-radius:999px;padding:6px 13px;box-shadow:0 10px 26px rgba(16,20,24,.16)}
.rh-prep::before{content:"";width:6px;height:6px;border-radius:3px;background:#3B82C4;animation:rh-blink 1.1s ease-in-out infinite}
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
  const { S, rules, onLog, next, voice, onSay, act } = ctx
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

  // 在不在电脑前：只看系统的输入空闲时长，不看你在干什么
  const helper = (act && act.helper) || ''
  const broken = helper === 'missing' || helper === 'fail'
  const st = broken ? 'off' : ((act && act.state) || 'unknown')
  const mins = (ms) => Math.max(0, Math.round((ms || 0) / 60000))
  const actText = st === 'focus'
    ? <>专注中 <b>{mins(act.sinceMs)} 分钟</b></>
    : st === 'desk'
      ? <>在电脑前{mins(act && act.seatMs) >= 1 ? <> <b>{mins(act.seatMs)} 分钟</b></> : null}</>
      : st === 'away'
        ? <>{act && act.since ? fmtHM(act.since) + ' 离开的' : '离开了'}</>
        : <>{helper === 'missing' ? '采样器没装' : '未在监测'}</>

  return (
    <>
      <style>{CSS}</style>
      <div className="lf-row" style={{ justifyContent: 'space-between', marginBottom: 2 }}>
        <h2 className="lf-h">日常</h2>
        <span className={'rh-act ' + st} title={broken ? '没在采样，状态点不亮' : '按最近一次键鼠输入判断'}>
          <i aria-hidden="true" />{actText}
        </span>
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
// 旁边一只药瓶：里面按满瓶的样子散着药片，一种药一个颜色，一天几次就几片；
// 位置是写死的，吃了哪片哪片淡下去，不会重排。
const MED_COLORS = ['#E2604C', '#3B82C4', '#1E9E6A', '#8B6BD9', '#D9963A', '#4C8C8C']
// 药瓶里药片的固定落点：四层从瓶底往上堆，层与层错开半个药片，各自带一点倾角。
// 序号即「第几颗药」，吃掉的只是把自己淡下去，坐标不动，其它药片不会被推着走。
const PILL_SLOTS = [
  { x: 30, y: 88, r: -16 },
  { x: 70, y: 87, r: 12 },
  { x: 26, y: 74, r: 8 },
  { x: 72, y: 73, r: -20 },
  { x: 34, y: 60, r: -10 },
  { x: 66, y: 61, r: 18 },
  { x: 28, y: 46, r: 14 },
  { x: 72, y: 45, r: -8 },
  { x: 38, y: 32, r: -18 },
  { x: 64, y: 31, r: 6 },
]

export function WaterCard({ ctx }) {
  const { S, onLog, onMinus, onSay, voice, meds, onMed, onMedUndo } = ctx
  const water = (S.routines && S.routines.today && S.routines.today.water) || { count: 0, ml: 0, lastAt: 0 }
  const cups = 8
  const got = Math.min(cups, Math.round((water.ml || 0) / 250) || water.count || 0)
  const full = got >= cups || (water.ml || 0) >= 2000
  const level = Math.round((Math.min(got, cups) / cups) * 100)
  const on = !(voice && voice.read && voice.read.water === false)
  const list = (Array.isArray(meds) ? meds : []).filter((m) => m && m.name)
  const today = (S.meds && S.meds.today) || {}
  const cntOf = (id) => (today[id] && today[id].count) || 0
  const allDone = list.length > 0 && list.every((m) => cntOf(m.id) >= m.times)
  // 瓶里该有几片就摆几片：按药顺序铺开，落点取自固定坐标表，吃掉的只淡色、不换位。
  const pills = []
  list.forEach((m, mi) => {
    const c = cntOf(m.id)
    for (let k = 0; k < m.times; k += 1) pills.push({ key: m.id + '-' + k, di: mi, taken: k < c })
  })
  return (
    <>
      <style>{CSS}</style>
      <div className="lf-row" style={{ justifyContent: 'space-between', marginBottom: 2 }}>
        <h2 className="lf-h">喝水吃药</h2>
        <span className="lf-sub">{allDone ? '今天的药吃完了' : list.length ? '点药名记一次' : (full ? '今天喝够了' : '点一下杯子加一杯')}</span>
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
        <div className="md-zone">
          <div className={'md-pot' + (list.length ? '' : ' empty')}>
            <span className="md-cap" aria-hidden="true" />
            <span className="md-body">
              {pills.length ? (
                <span className="md-slots" aria-hidden="true">
                  {pills.map((p, i) => {
                    const s = PILL_SLOTS[i % PILL_SLOTS.length]
                    return (
                      <span
                        key={p.key}
                        className={'md-pill' + (p.taken ? ' on' : '')}
                        style={{
                          '--rot': s.r + 'deg',
                          '--pc': MED_COLORS[p.di % MED_COLORS.length],
                          left: s.x + '%',
                          top: s.y + '%',
                          zIndex: Math.round(s.y),
                        }}
                      />
                    )
                  })}
                </span>
              ) : null}
            </span>
          </div>
          <div className="md-legend">
            {list.length ? list.map((m) => {
              const c = cntOf(m.id)
              const done = c >= m.times
              return (
                <div className="md-row" key={m.id}>
                  <button
                    type="button"
                    className="md-take"
                    onClick={(e) => { e.stopPropagation(); onMed(m) }}
                    disabled={done}
                    title={done ? m.name + ' 今天吃够了' : '点一下，记一次 ' + m.name}
                    aria-label={m.name + ' 已吃 ' + c + ' 次，共 ' + m.times + ' 次' + (done ? '，今天吃够了' : '，点一下记一次')}
                  >
                    <span className="md-name">{m.name}</span>
                    <b className={'md-cnt' + (done ? ' done' : '')}>{c}/{m.times}</b>
                  </button>
                  <button
                    type="button"
                    className="md-minus"
                    onClick={(e) => { e.stopPropagation(); onMedUndo(m) }}
                    disabled={c === 0}
                    title={c === 0 ? '今天还没吃，没得撤' : '撤掉一次 ' + m.name}
                    aria-label={'撤回 ' + m.name + ' 一次'}
                  >−</button>
                </div>
              )
            }) : <div className="wh-last">背面加药</div>}
          </div>
        </div>
      </div>
    </>
  )
}

// 喝水卡背面：一种药一行，写名字、定一天几次；药丸数量跟着次数走，删掉这种药，药丸就一起没了
export function BackWaterMeds({ meds, onChange }) {
  const [local, setLocal] = useState(() => (Array.isArray(meds) ? meds : []))
  useEffect(() => { setLocal(Array.isArray(meds) ? meds : []) }, [meds])
  const commit = (next) => { setLocal(next); onChange(next) }
  const patch = (id, kv) => commit(local.map((m) => (m.id === id ? { ...m, ...kv } : m)))
  const del = (id) => commit(local.filter((m) => m.id !== id))
  const add = () => commit([...local, { id: 'm' + Date.now().toString(36), name: '新药', times: 1 }])
  return (
    <>
      <style>{CSS}</style>
      <h2 className="lf-h" style={{ marginBottom: 6 }}>吃什么药</h2>
      <div className="md-list">
        {local.length ? local.map((m) => (
          <div className="md-edit" key={m.id}>
            <input
              className="md-input"
              value={m.name}
              maxLength={12}
              placeholder="药名"
              aria-label="药名"
              onChange={(e) => { const v = e.target.value; setLocal(local.map((x) => (x.id === m.id ? { ...x, name: v } : x))) }}
              onBlur={() => onChange(local)}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
            />
            <span className="md-step">
              <button type="button" className="rh-step" onClick={() => patch(m.id, { times: Math.max(1, m.times - 1) })} aria-label="少吃一次">−</button>
              <span className="t">{m.times} 次</span>
              <button type="button" className="rh-step" onClick={() => patch(m.id, { times: Math.min(6, m.times + 1) })} aria-label="多吃一次">+</button>
            </span>
            <button type="button" className="rh-drop" onClick={() => del(m.id)} aria-label={'删掉 ' + (m.name || '这种药')}>−</button>
          </div>
        )) : <p className="rh-note">还没加药。加一种，正面就多出一排药丸。</p>}
      </div>
      {local.length < 6 ? (
        <button type="button" className="rh-open md-add" onClick={add}>+ 加一种药</button>
      ) : null}
      <p className="rh-note">一天几次就放几粒胶囊，位置是固定的，吃一粒淡一粒。药名点一下记一次，旁边的减号撤回。名字最多 12 个字，最多 6 种药。</p>
    </>
  )
}
// 背面只剩提醒节奏；语音那套搬到独立面板（src/voice.jsx），入口在页面顶部。
export function BackRoutine({ rules, onToggle, onEvery, onGap, onSit, onTime, onAddTime }) {
  return (
    <>
      <style>{CSS}</style>
      <h2 className="lf-h" style={{ marginBottom: 8 }}>提醒怎么设</h2>
      <div className="rh-rules">
        {(rules || []).map((r) => {
          const times = Array.isArray(r.times) ? r.times : []
          return (
            <div className="rh-rule" key={r.id}>
              <span className="n">{r.title}</span>
              <button type="button" className={'rh-sw' + (r.enabled !== false ? ' on' : '')} onClick={() => onToggle(r.id)} aria-label={r.enabled !== false ? '关掉' : '打开'} aria-pressed={r.enabled !== false} />
              <div className="rh-ctl">
                {r.mode === 'interval' ? (
                  <>
                    <span className="lf-row" style={{ gap: 4 }}>
                      <button type="button" className="rh-step" onClick={() => onEvery(r.id, -15)} aria-label="少十五分钟">−</button>
                      <span className="t">{r.everyMin} 分钟</span>
                      <button type="button" className="rh-step" onClick={() => onEvery(r.id, 15)} aria-label="多十五分钟">+</button>
                    </span>
                    <span className="rh-winline">
                      <input type="time" className="rh-time" value={r.from || '09:00'} onChange={(e) => onTime(r.id, { from: e.target.value, to: r.to || '21:00' })} aria-label={r.title + ' 从几点开始'} />
                      <span>到</span>
                      <input type="time" className="rh-time" value={r.to || '21:00'} onChange={(e) => onTime(r.id, { from: r.from || '09:00', to: e.target.value })} aria-label={r.title + ' 到几点结束'} />
                    </span>
                  </>
                ) : r.mode === 'gap' ? (
                  <>
                    <span className="lf-row" style={{ gap: 4 }}>
                      <button type="button" className="rh-step" onClick={() => onGap(r.id, -1)} aria-label="少一天">−</button>
                      <span className="t">{r.minGapDays} 天</span>
                      <button type="button" className="rh-step" onClick={() => onGap(r.id, 1)} aria-label="多一天">+</button>
                    </span>
                    <input type="time" className="rh-time" value={r.at || '22:30'} onChange={(e) => onTime(r.id, { at: e.target.value })} aria-label={r.title + ' 几点提醒'} />
                  </>
                ) : r.mode === 'sit' ? (
                  <span className="lf-row" style={{ gap: 4 }}>
                    <button type="button" className="rh-step" onClick={() => onSit(r.id, -10)} aria-label="少十分钟">−</button>
                    <span className="t">坐 {r.afterMin} 分钟</span>
                    <button type="button" className="rh-step" onClick={() => onSit(r.id, 10)} aria-label="多十分钟">+</button>
                  </span>
                ) : (
                  <>
                    {times.map((t, i) => (
                      <span className="rh-timewrap" key={i}>
                        <input type="time" className="rh-time" value={t} aria-label={r.title + ' 第 ' + (i + 1) + ' 个时间'}
                          onChange={(e) => { const nx = times.slice(); nx[i] = e.target.value; onTime(r.id, { times: nx }) }} />
                        {times.length > 1 ? (
                          <button type="button" className="rh-drop" onClick={() => onTime(r.id, { times: times.filter((_, k) => k !== i) })} aria-label={'删掉 ' + r.title + ' 第 ' + (i + 1) + ' 个时间'}>−</button>
                        ) : null}
                      </span>
                    ))}
                    {times.length < 4 ? (
                      <button type="button" className="rh-step" onClick={() => onAddTime(r.id)} aria-label={'给 ' + r.title + ' 加一个时间'}>+</button>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <p className="rh-note">时间点可以直接改，改完立刻按新时刻算；点一下就记下，记完自动顺延。面板关着也会弹系统提醒，待办和日程到点同样会提醒。</p>
    </>
  )
}

export function ReminderStack({ items, onDone, onSnooze, onSkip, speaking }) {
  if (!items || !items.length) return null
  const prep = !!(speaking && speaking.preparing)
  return (
    <>
      <style>{CSS}</style>
      <div className="rh-stack" role="status">
        {prep ? <div className="rh-prep">语音还在备，好了马上念</div> : null}
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
