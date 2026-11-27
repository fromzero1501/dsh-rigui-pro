// 日晷 Pro · 语音设置面板
// 独立全屏面板：总开关、云端 / 本地两路 TTS、逐事项要不要念、播放器与缓存状态。
// 之前塞在「日常」卡背面装不下（卡高 336px，内容 600px），挪出来才够用。
import React, { useEffect, useMemo, useState } from 'react'
import { routineName } from './habits.js'

const CSS = `
.rv-scrim{position:fixed;inset:0;z-index:60;background:rgba(16,20,24,.42);backdrop-filter:blur(3px);animation:rv-fade .18s ease both}
.rv-wrap{position:fixed;z-index:61;left:50%;top:50%;transform:translate(-50%,-50%);width:min(620px,calc(100vw - 40px));max-height:min(86vh,820px);display:flex;flex-direction:column;
  background:var(--card,#fff);color:var(--ink,#1F2328);border:1px solid var(--rule,rgba(31,35,40,.1));border-radius:22px;box-shadow:0 32px 80px rgba(16,20,24,.28);overflow:hidden;animation:rv-rise .26s cubic-bezier(.2,.8,.2,1) both}
@keyframes rv-fade{from{opacity:0}to{opacity:1}}
@keyframes rv-rise{from{opacity:0;transform:translate(-50%,-46%)}to{opacity:1;transform:translate(-50%,-50%)}}
.rv-head{padding:22px 24px 14px;border-bottom:1px solid var(--rule,rgba(31,35,40,.08))}
.rv-title{display:flex;align-items:baseline;gap:10px;font-size:20px;font-weight:600;letter-spacing:-.01em}
.rv-title small{font-size:13px;font-weight:400;color:var(--ink2,#6B7280)}
.rv-sum{margin-top:6px;font-size:13.5px;line-height:1.6;color:var(--ink2,#6B7280)}
.rv-body{flex:1;overflow:auto;padding:8px 24px 18px}
.rv-sub{font-size:13px;font-weight:600;margin:18px 0 8px}
.rv-sub:first-child{margin-top:8px}
.rv-row{display:flex;align-items:center;gap:8px;padding:5px 0}
.rv-row .n{width:82px;flex:none;font-size:13px;color:var(--ink2,#6B7280)}
.rv-in{flex:1;min-width:0;height:36px;padding:0 11px;border-radius:10px;border:1px solid var(--rule,rgba(31,35,40,.16));background:transparent;color:inherit;font:inherit;font-size:13.5px}
.rv-in:focus{outline:2px solid rgba(242,153,74,.5);outline-offset:-1px}
.rv-seg{display:inline-flex;border:1px solid var(--rule,rgba(31,35,40,.14));border-radius:10px;overflow:hidden}
.rv-seg button{height:32px;padding:0 14px;border:0;background:transparent;color:inherit;font:inherit;font-size:13.5px;cursor:pointer}
.rv-seg button.on{background:rgba(242,153,74,.22);font-weight:600}
.rv-sw{width:42px;height:24px;border-radius:12px;border:0;background:var(--rule,rgba(31,35,40,.16));position:relative;cursor:pointer;flex:none;transition:background .18s ease}
.rv-sw.on{background:#1E9E6A}
.rv-sw::after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:9px;background:#fff;transition:transform .18s cubic-bezier(.2,.8,.2,1)}
.rv-sw.on::after{transform:translateX(18px)}
.rv-note{font-size:12.5px;line-height:1.65;color:var(--ink2,#6B7280);margin:8px 0 0}
.rv-warn{margin:10px 0 0;padding:10px 12px;border-radius:10px;background:rgba(242,153,74,.12);font-size:12.5px;line-height:1.6}
.rv-foot{padding:14px 24px 18px;border-top:1px solid var(--rule,rgba(31,35,40,.08));display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;background:var(--card,#fff)}
.rv-btn{height:38px;padding:0 16px;border-radius:11px;border:1px solid var(--rule,rgba(31,35,40,.14));background:transparent;color:inherit;font:inherit;font-size:13.5px;cursor:pointer}
.rv-btn:hover{background:rgba(31,35,40,.05)}
.rv-btn.main{background:#1F2328;color:#F4F5F1;border-color:#1F2328;font-weight:600}
.rv-btn.main:disabled{opacity:.45;cursor:default}
.rv-btn.sm{height:26px;min-width:26px;padding:0 8px;border-radius:8px;font-size:13px;line-height:1}
.rv-num{min-width:56px;text-align:center;font-variant-numeric:tabular-nums;font-size:13px}
.rv-row .rh-inline{display:inline-flex;align-items:center;gap:6px}
`

const READ_KINDS = ['water', 'shower', 'hair', 'meal', 'sleep']
const GROUPS = [['routine', '日常琐事'], ['todo', '待办'], ['event', '日程']]

const blank = (v) => ({
  cloud: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts', voice: 'alloy', format: 'mp3', ...((v && v.cloud) || {}) },
  local: { shape: 'gradio', baseUrl: 'http://127.0.0.1:7860', apiName: 'gen_single', format: 'wav', ...((v && v.local) || {}) },
})

export default function VoicePanel({ open, voice, onClose, onSave, onTest, onToggleRead, onGroup, onLead }) {
  const v = voice || {}
  const [d, setD] = useState(() => blank(v))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => { if (open) { setD(blank(voice)); setMsg('') } }, [open, voice && voice.lastAt])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const enabled = !!v.enabled
  const provider = v.provider === 'local' ? 'local' : 'cloud'
  const localShape = d.local.shape || 'gradio'
  const ready = useMemo(() => {
    if (provider === 'cloud') return !!(d.cloud.baseUrl && d.cloud.apiKey)
    return !!d.local.baseUrl
  }, [provider, d])

  if (!open) return null

  const setField = (grp, f, val) => setD((x) => ({ ...x, [grp]: { ...x[grp], [f]: val } }))
  const flip = (patch) => { if (onSave) onSave(patch) }
  const save = async () => {
    setBusy(true); setMsg('')
    try {
      const r = onSave ? await onSave({ provider, cloud: d.cloud, local: d.local }) : null
      setMsg(!r || r.ok === false ? '没存上：' + ((r && r.error) || '主机没回应') : '存好了')
    } finally { setBusy(false) }
  }
  const test = () => { if (onTest) onTest() }

  return (
    <>
      <style>{CSS}</style>
      <div className="rv-scrim" onClick={onClose} aria-hidden="true" />
      <div className="rv-wrap" role="dialog" aria-modal="true" aria-label="语音设置">
        <div className="rv-head">
          <div className="rv-title">语音<small>{enabled ? (provider === 'cloud' ? '云端在念' : '本地在念') : '现在不念，只弹提醒'}</small></div>
          <div className="rv-sum">到点会把这句话念出来：云端走 OpenAI 兼容的 /audio/speech，本地走 IndexTTS 的 Gradio 接口。念过的句子会缓存，下次直接播。</div>
        </div>

        <div className="rv-body">
          <div className="rv-row">
            <span className="n">到点念</span>
            <button type="button" className={'rv-sw' + (enabled ? ' on' : '')} onClick={() => flip({ enabled: !enabled })} aria-pressed={enabled} aria-label={enabled ? '关掉语音' : '打开语音'} />
            <span style={{ flex: 1 }} />
            <span className="rv-seg">
              <button type="button" className={provider === 'cloud' ? 'on' : ''} onClick={() => flip({ provider: 'cloud' })}>云端</button>
              <button type="button" className={provider === 'local' ? 'on' : ''} onClick={() => flip({ provider: 'local' })}>本地</button>
            </span>
          </div>

          <div className="rv-sub">{provider === 'cloud' ? '云端 TTS' : '本地 TTS'}</div>
          {provider === 'cloud' ? (
            <>
              <div className="rv-row"><span className="n">地址</span><input className="rv-in" value={d.cloud.baseUrl || ''} onChange={(e) => setField('cloud', 'baseUrl', e.target.value)} placeholder="https://api.openai.com/v1" /></div>
              <div className="rv-row"><span className="n">密钥</span><input className="rv-in" value={d.cloud.apiKey || ''} onChange={(e) => setField('cloud', 'apiKey', e.target.value)} placeholder="sk-…（明文存在本机 rigui-pro.json）" /></div>
              <div className="rv-row"><span className="n">模型</span><input className="rv-in" value={d.cloud.model || ''} onChange={(e) => setField('cloud', 'model', e.target.value)} placeholder="gpt-4o-mini-tts 或 tts-1" /></div>
              <div className="rv-row"><span className="n">音色</span><input className="rv-in" value={d.cloud.voice || ''} onChange={(e) => setField('cloud', 'voice', e.target.value)} placeholder="alloy / nova / 自定义" /></div>
              <div className="rv-row"><span className="n">格式</span>
                <span className="rv-seg">
                  {['mp3', 'wav', 'opus'].map((f) => (
                    <button key={f} type="button" className={(d.cloud.format || 'mp3') === f ? 'on' : ''} onClick={() => setField('cloud', 'format', f)}>{f}</button>
                  ))}
                </span>
              </div>
              <p className="rv-note">任何 OpenAI 兼容的语音接口都行（SiliconFlow、Azure 代理、自建网关）：把地址换成它的 /v1，模型和音色按它的文档填。</p>
            </>
          ) : (
            <>
              <div className="rv-row"><span className="n">形态</span>
                <span className="rv-seg">
                  <button type="button" className={localShape === 'gradio' ? 'on' : ''} onClick={() => setField('local', 'shape', 'gradio')}>IndexTTS</button>
                  <button type="button" className={localShape === 'openai' ? 'on' : ''} onClick={() => setField('local', 'shape', 'openai')}>OpenAI 兼容</button>
                </span>
              </div>
              <div className="rv-row"><span className="n">服务地址</span><input className="rv-in" value={d.local.baseUrl || ''} onChange={(e) => setField('local', 'baseUrl', e.target.value)} placeholder="http://127.0.0.1:7860" /></div>
              {localShape === 'gradio' ? (
                <>
                  <div className="rv-row"><span className="n">接口名</span><input className="rv-in" value={d.local.apiName || ''} onChange={(e) => setField('local', 'apiName', e.target.value)} placeholder="gen_single" /></div>
                  <div className="rv-row"><span className="n">参考音频</span><input className="rv-in" value={d.local.voicePath || ''} onChange={(e) => setField('local', 'voicePath', e.target.value)} placeholder={'D:\\voices\\me.wav'} /></div>
                  <div className="rv-row"><span className="n">参数模板</span><input className="rv-in" value={d.local.payload || ''} onChange={(e) => setField('local', 'payload', e.target.value)} placeholder='留空就发 ["文案","参考音频"]' /></div>
                  <p className="rv-note">接口名在服务的 <code>/gradio_api/info</code> 里查；参考音频是给 IndexTTS 做音色克隆的那条 wav。</p>
                </>
              ) : (
                <>
                  <div className="rv-row"><span className="n">模型</span><input className="rv-in" value={d.local.model || ''} onChange={(e) => setField('local', 'model', e.target.value)} placeholder="tts-1" /></div>
                  <div className="rv-row"><span className="n">音色</span><input className="rv-in" value={d.local.voice || ''} onChange={(e) => setField('local', 'voice', e.target.value)} placeholder="zh-female" /></div>
                </>
              )}
            </>
          )}

          <div className="rv-sub">哪几件要念</div>
          {READ_KINDS.map((k) => {
            const rOn = !(v.read && v.read[k] === false)
            return (
              <div className="rv-row" key={k}>
                <span className="n">{routineName(k)}</span>
                <button type="button" className={'rv-sw' + (rOn ? ' on' : '')} onClick={() => onToggleRead && onToggleRead(k, !rOn)} aria-pressed={rOn} aria-label={routineName(k) + (rOn ? '要念' : '不念')} />
              </div>
            )
          })}
          <p className="rv-note">卡片上每件事旁边的小喇叭跟这里同步：点亮就念，再点一下这件事就不念。</p>

          <div className="rv-sub">哪几类要念</div>
          {GROUPS.map(([g, name]) => {
            const gOn = !(v.groups && v.groups[g] === false)
            return (
              <div className="rv-row" key={g}>
                <span className="n">{name}</span>
                <button type="button" className={'rv-sw' + (gOn ? ' on' : '')} onClick={() => onGroup && onGroup(g, !gOn)} aria-pressed={gOn} aria-label={name + (gOn ? '要念' : '不念')} />
              </div>
            )
          })}
          <div className="rv-row">
            <span className="n">日程提前</span>
            <span className="rh-inline">
              <button type="button" className="rv-btn sm" onClick={() => onLead && onLead(-1)} aria-label="少一分钟">−</button>
              <span className="rv-num">{v.leadMin || 0} 分钟</span>
              <button type="button" className="rv-btn sm" onClick={() => onLead && onLead(1)} aria-label="多一分钟">+</button>
            </span>
          </div>
          <p className="rv-note">待办按你说的钟点念；日程在开始前这个分钟数念，0 就是到点念。深夜 23:30–07:30 只静音生活琐事，待办和日程照念。</p>

          {msg ? <div className="rv-warn">{msg}</div> : null}
          {!ready ? <div className="rv-warn">{provider === 'cloud' ? '还差地址或密钥，现在点了也念不出来。' : '还差服务地址。'}</div> : null}
          {v.lastError ? <div className="rv-warn">上次出错：{v.lastError}</div> : null}
          <p className="rv-note">
            播放器：{v.ffplay ? 'ffplay 可用' : '没找到 ffplay（非 wav 播不了）'} · 缓存 {v.cache ? v.cache.count : 0} 条 · 深夜 23:30–07:30 不念，只弹提醒。
          </p>
        </div>

        <div className="rv-foot">
          <button type="button" className="rv-btn" onClick={onClose}>收起</button>
          <button type="button" className="rv-btn" onClick={test}>念一句试试</button>
          <button type="button" className="rv-btn main" onClick={save} disabled={busy}>{busy ? '存…' : '保存'}</button>
        </div>
      </div>
    </>
  )
}
