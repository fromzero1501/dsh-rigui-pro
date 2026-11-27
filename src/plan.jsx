// 日晷 Pro · 排程面板
// AI 把「要做的事」排成时间块后，先摆在这里给人看：可以逐条取舍、可以补一句要求让它重排，
// 确认了才写进日程（event 记录），不会偷偷改数据。
import React, { useEffect, useMemo, useRef, useState } from 'react'

const CSS = `
.rp-scrim{position:fixed;inset:0;z-index:60;background:rgba(16,20,24,.42);backdrop-filter:blur(3px);animation:rp-fade .18s ease both}
.rp-wrap{position:fixed;z-index:61;left:50%;top:50%;transform:translate(-50%,-50%);width:min(720px,calc(100vw - 40px));max-height:min(86vh,880px);display:flex;flex-direction:column;
  background:var(--card,#fff);color:var(--ink,#1F2328);border:1px solid var(--rule,rgba(31,35,40,.1));border-radius:22px;box-shadow:0 32px 80px rgba(16,20,24,.28);overflow:hidden;animation:rp-rise .26s cubic-bezier(.2,.8,.2,1) both}
@keyframes rp-fade{from{opacity:0}to{opacity:1}}
@keyframes rp-rise{from{opacity:0;transform:translate(-50%,-46%)}to{opacity:1;transform:translate(-50%,-50%)}}
.rp-head{padding:22px 24px 14px;border-bottom:1px solid var(--rule,rgba(31,35,40,.08))}
.rp-title{display:flex;align-items:baseline;gap:10px;font-size:20px;font-weight:600;letter-spacing:-.01em}
.rp-title small{font-size:13px;font-weight:400;color:var(--ink2,#6B7280)}
.rp-sum{margin-top:6px;font-size:14px;line-height:1.6;color:var(--ink2,#6B7280)}
.rp-body{flex:1;overflow:auto;padding:6px 24px 16px}
.rp-row{display:flex;gap:14px;padding:12px 0;border-bottom:1px solid var(--rule,rgba(31,35,40,.07));cursor:pointer;align-items:flex-start}
.rp-row:last-child{border-bottom:0}
.rp-row.off{opacity:.38}
.rp-time{flex:none;width:96px;font-variant-numeric:tabular-nums;font-size:13.5px;color:var(--ink2,#6B7280);padding-top:2px}
.rp-time b{display:block;font-size:15px;font-weight:600;color:var(--ink,#1F2328)}
.rp-main{flex:1;min-width:0}
.rp-name{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:500}
.rp-dot{width:8px;height:8px;border-radius:50%;flex:none}
.rp-why{margin-top:3px;font-size:12.5px;line-height:1.55;color:var(--ink2,#6B7280)}
.rp-tick{flex:none;width:22px;height:22px;border-radius:7px;border:1.5px solid var(--line,#D7DBE0);display:grid;place-items:center;margin-top:2px}
.rp-row.off .rp-tick{border-color:transparent}
.rp-row:not(.off) .rp-tick{background:#1E9E6A;border-color:#1E9E6A}
.rp-notes{margin:4px 0 0;padding:12px 14px;border-radius:12px;background:rgba(242,153,74,.1);font-size:13px;line-height:1.6}
.rp-q{margin:10px 0 0;padding:12px 14px;border-radius:12px;background:rgba(61,79,184,.1);font-size:13.5px;line-height:1.6}
.rp-foot{padding:14px 24px 20px;border-top:1px solid var(--rule,rgba(31,35,40,.08));display:flex;flex-direction:column;gap:12px;background:var(--card,#fff)}
.rp-ask{display:flex;gap:8px}
.rp-ask input{flex:1;height:40px;border-radius:11px;border:1px solid var(--rule,rgba(31,35,40,.14));background:transparent;color:inherit;padding:0 12px;font:inherit;font-size:14px}
.rp-ask input:focus{outline:2px solid rgba(242,153,74,.55);outline-offset:-1px}
.rp-btns{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}
.rp-btn{height:40px;padding:0 18px;border-radius:11px;border:1px solid var(--rule,rgba(31,35,40,.14));background:transparent;color:inherit;font:inherit;font-size:14px;cursor:pointer}
.rp-btn:hover{background:rgba(31,35,40,.05)}
.rp-btn.main{background:#1F2328;color:#F4F5F1;border-color:#1F2328;font-weight:600}
.rp-btn.main:disabled{opacity:.45;cursor:default}
.rp-empty{padding:34px 0;text-align:center;color:var(--ink2,#6B7280);font-size:14px;line-height:1.8}
.rp-load{display:flex;flex-direction:column;gap:10px;padding:20px 0}
.rp-skel{height:16px;border-radius:8px;background:var(--rule,rgba(31,35,40,.08));animation:rp-pulse 1.2s ease-in-out infinite}
@keyframes rp-pulse{0%,100%{opacity:.5}50%{opacity:1}}
`

const DOMAIN_COLOR = { admin: '#0E8A8A', work: '#3D4FB8', life: '#F2994A', move: '#1E9E6A', rest: '#7C5CE0' }
const DOMAIN_NAME = { admin: '办事', work: '干活', life: '生活', move: '运动', rest: '休息' }

const Tick = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7" />
  </svg>
)

export default function PlanPanel({ open, draft, date, busy, error, onClose, onAccept, onReplan }) {
  const [off, setOff] = useState({})
  const [ask, setAsk] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { if (open) { setOff({}); setAsk('') } }, [open, draft && draft.date, draft && draft.summary])
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const blocks = (draft && draft.blocks) || []
  const kept = useMemo(() => blocks.filter((b, i) => !off[i]), [blocks, off])
  if (!open) return null

  const toggle = (i) => setOff((o) => ({ ...o, [i]: !o[i] }))
  const redo = () => { if (busy) return; onReplan(ask.trim()) }
  const accept = () => { if (busy || !kept.length) return; onAccept(kept) }

  return (
    <>
      <style>{CSS}</style>
      <div className="rp-scrim" onClick={onClose} aria-hidden="true" />
      <div className="rp-wrap" role="dialog" aria-modal="true" aria-label="今天的安排">
        <div className="rp-head">
          <div className="rp-title">
            {date ? date.slice(5).replace('-', ' 月 ') + ' 日' : '今天'}的安排
            <small>{busy ? '正在排…' : blocks.length ? `排了 ${blocks.length} 件事，不想要的点掉` : ''}</small>
          </div>
          <div className="rp-sum">{draft && draft.summary ? draft.summary : busy ? '先看你的日程和习惯，再动手排。' : '还没排出来。'}</div>
        </div>

        <div className="rp-body">
          {busy && !blocks.length ? (
            <div className="rp-load">
              <span className="rp-skel" style={{ width: '72%' }} />
              <span className="rp-skel" style={{ width: '54%' }} />
              <span className="rp-skel" style={{ width: '64%' }} />
              <span className="rp-skel" style={{ width: '44%' }} />
            </div>
          ) : error ? (
            <div className="rp-empty">{error}<br />可以改一句要求再排一次。</div>
          ) : !blocks.length ? (
            <div className="rp-empty">这一天没有必须排进去的事。<br />你可以说「上午写脚本、下午寄快递」，我再来排。</div>
          ) : (
            <>
              {blocks.map((b, i) => (
                <div key={i} className={'rp-row' + (off[i] ? ' off' : '')} role="button" tabIndex={0} aria-pressed={!off[i]}
                  onClick={() => toggle(i)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(i) } }}>
                  <div className="rp-time"><b>{b.start}</b>{b.end}</div>
                  <div className="rp-main">
                    <div className="rp-name">
                      <span className="rp-dot" style={{ background: DOMAIN_COLOR[b.domain] || '#6B7280' }} />
                      {b.title}
                      <span style={{ fontSize: 12, color: 'var(--ink2,#6B7280)', fontWeight: 400 }}>{DOMAIN_NAME[b.domain] || ''}</span>
                    </div>
                    {b.why ? <div className="rp-why">{b.why}</div> : null}
                  </div>
                  <span className="rp-tick" aria-hidden="true">{off[i] ? null : Tick}</span>
                </div>
              ))}
              {draft && draft.question ? <div className="rp-q">{draft.question}</div> : null}
              {draft && draft.notes && draft.notes.length ? (
                <div className="rp-notes">{draft.notes.map((n, i) => <div key={i}>· {n}</div>)}</div>
              ) : null}
            </>
          )}
        </div>

        <div className="rp-foot">
          <div className="rp-ask">
            <input ref={inputRef} value={ask} placeholder="要改哪里？比如「上午别排事，我起不来」"
              onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); redo() } }} />
            <button type="button" className="rp-btn" onClick={redo} disabled={busy}>{busy ? '排…' : '重排'}</button>
          </div>
          <div className="rp-btns">
            <button type="button" className="rp-btn" onClick={onClose}>先不排</button>
            <button type="button" className="rp-btn main" onClick={accept} disabled={busy || !kept.length}>
              {kept.length ? `就按这 ${kept.length} 件走` : '没有要排的'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
