import { useCallback, useEffect, useState } from 'react'
import sample from './sample.json'
import Explain from '../../ui/Explain.jsx'

// Not auto-registered as a panel (no default export): the reveal view mounts <Verify /> directly.

async function sha256Hex(bytes) {
  const buf = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function getJson(url, ms = 12000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    if (!r.ok) throw new Error(String(r.status))
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}

async function rpc(url, method, params) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const body = await r.json()
  if (body.error) throw new Error(body.error.message)
  return body.result
}

function memoFromLogs(tx) {
  const line = (tx?.meta?.logMessages ?? []).find((l) => l.includes('Memo (len'))
  const m = line?.match(/"(.*)"$/)
  return m ? m[1] : null
}

// "Try cheating": add 1 to one best guess (GB at 18:00 if the file has it, else the first row), so the viewer can see
// which number changed. Falls back to the last digit in the file if it is not the forecast CSV.
function cheat(text) {
  const lines = text.split('\n')
  const head = lines[0].split(',')
  const [iz, it, ip] = ['zone', 'ts', 'p50'].map((k) => head.indexOf(k))
  if (iz < 0 || it < 0 || ip < 0) return { text: text.replace(/\d(?=[^\d]*$)/, (d) => String((Number(d) + 1) % 10)), changed: null }
  const rows = lines.map((l) => l.split(','))
  let i = rows.findIndex((r, k) => k > 0 && r[iz] === 'GB' && /T18:00/.test(r[it] ?? ''))
  if (i < 0) i = 1
  const r = rows[i]
  const was = Number(r[ip])
  r[ip] = String(was + 1)
  lines[i] = r.join(',')
  const when = new Date(r[it])
  const day = when.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
  return { text: lines.join('\n'), changed: `${r[iz]} ${day} ${r[it].slice(11, 16)} best guess ${was.toFixed(2)} → ${(was + 1).toFixed(2)}` }
}

const fp = (h) => (h ? `${h.slice(0, 8)}…${h.slice(-4)}` : null)
const hhmm = (iso) => (iso ? new Date(iso).toISOString().slice(11, 16) : null)

const short = (s, n = 8) => (s ? `${s.slice(0, n)}…${s.slice(-n)}` : '—')
const explorerTx = (sig, cluster) => `https://explorer.solana.com/tx/${sig}${cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`}`

export function Verify() {
  const [info, setInfo] = useState(undefined)
  const [txs, setTxs] = useState([])
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [tamper, setTamper] = useState(false)

  useEffect(() => {
    let live = true
    getJson('/api/commitments')
      .then((d) => live && setInfo(d))
      .catch(() => live && setInfo(null))
    return () => (live = false)
  }, [])

  const data = info ?? (info === null ? sample : null)
  const posted = (data?.records ?? []).filter((r) => r.signature)
  const rec = posted.find((r) => r.kind === 'freeze') ?? posted[0]

  useEffect(() => {
    if (!data?.wallet || data.cached) return
    rpc(data.rpc, 'getSignaturesForAddress', [data.wallet, { limit: 40 }]).then(setTxs).catch(() => setTxs([]))
  }, [data?.wallet, data?.rpc, data?.cached])

  const run = useCallback(
    async (altered) => {
      if (!rec) return
      setBusy(true)
      setResult(null)
      try {
        let text = await fetch(`/api/commitments/file/${rec.id}`).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`file ${r.status}`))))
        let changed = null
        if (altered) ({ text, changed } = cheat(text))
        const browser = await sha256Hex(new TextEncoder().encode(text))
        const tx = await rpc(data.rpc, 'getTransaction', [rec.signature, { encoding: 'json', maxSupportedTransactionVersion: 0 }])
        const memo = memoFromLogs(tx)
        const onChain = memo?.split('|')[3] ?? null
        setResult({ browser, onChain, memo, match: !!onChain && onChain === browser, altered, changed, error: tx ? null : 'Transaction not found on chain yet' })
      } catch (e) {
        setResult({ error: `Could not verify: ${e.message}` })
      } finally {
        setBusy(false)
      }
    },
    [rec, data],
  )

  useEffect(() => {
    if (rec && !data?.cached) run(tamper)
  }, [rec?.id, tamper]) // eslint-disable-line react-hooks/exhaustive-deps

  const ready = result && !result.error && !busy
  const same = ready && result.match
  const published = hhmm(rec?.posted_at)

  const answer = (
    <>
      {data === null && <p className="faint">Loading…</p>}
      {data?.cached && <p className="vf-warn">The proof service is not reachable, so there is nothing cached to check. {data.note}</p>}
      {data && !data.cached && !rec && (
        <p className="faint">No commitment has been posted on chain yet. The first one follows the 23:59 UTC freeze on Saturday.</p>
      )}
      {rec && (
        <div className={`vf-card ${ready ? (same ? 'ok' : 'bad') : ''}`}>
          <div className="vf-verdict" role="status">
            Did we change our forecast after seeing the result?{' '}
            <b>{busy || !result ? 'Not yet checked' : result.error ? 'Could not check' : same ? 'No.' : 'This copy was changed.'}</b>
          </div>
          <div className="vf-pair">
            <div className="vf-fp">
              <span>Fingerprint we published{published ? ` at ${published} UTC` : ''} on Solana</span>
              <code>{fp(result?.onChain) ?? (busy ? 'reading…' : '—')}</code>
            </div>
            <div className={`vf-eq ${ready ? (same ? 'ok' : 'bad') : ''}`} aria-hidden="true">{ready ? (same ? '=' : '≠') : '?'}</div>
            <div className="vf-fp">
              <span>Fingerprint of the forecast on this page</span>
              <code>{fp(result?.browser) ?? (busy ? 'working…' : '—')}</code>
            </div>
          </div>
          {result?.error && !busy && <p className="vf-warn">{result.error}</p>}
          {ready && (
            <p className="vf-say">
              {same
                ? 'Same fingerprint, so this is exactly the forecast we sealed before the auction.'
                : 'Different fingerprint: even one changed number gives a completely new fingerprint, so any edit would show.'}
            </p>
          )}
          {ready && result.altered && result.changed && <p className="vf-changed">Changed: {result.changed}</p>}
          <div className="vf-actions">
            <button className="btn" onClick={() => setTamper((t) => !t)} disabled={busy}>{tamper ? 'Undo' : 'Try cheating: change one number'}</button>
            <a href={explorerTx(rec.signature, data.cluster)} target="_blank" rel="noreferrer">Check it on Solana yourself ↗</a>
          </div>
        </div>
      )}
    </>
  )

  const experts = (
    <div className="vf-x">
      <p>
        We hash each frozen forecast with SHA-256 and post the hash to Solana {data?.cluster ?? 'devnet'} from one published wallet. This page hashes the file in your browser and reads the memo
        straight from the chain. A hash shows <i>that</i> forecast existed unchanged; the wallet’s full history below shows we did not post others.
      </p>
      {rec && (
        <div className="vf-rows">
          <div className="vf-row">
            <span>Forecast</span>
            <b>{rec.kind === 'freeze' ? 'Frozen Monday forecast' : 'Hourly run'} · {rec.label} · {rec.rows} rows</b>
          </div>
          <div className="vf-row"><span>Hash in your browser</span><code>{result?.browser ?? (busy ? 'hashing…' : '—')}</code></div>
          <div className="vf-row"><span>Hash on chain (memo)</span><code>{result?.onChain ?? (busy ? 'reading…' : '—')}</code></div>
          <div className="vf-actions">
            <a href={explorerTx(rec.signature, data.cluster)} target="_blank" rel="noreferrer">View transaction ↗</a>
            <a href={`/api/commitments/file/${rec.id}`} target="_blank" rel="noreferrer">Download the hashed file</a>
          </div>
        </div>
      )}
      {data?.wallet && (
        <div className="vf-list">
          <div className="vf-row">
            <span>Published wallet</span>
            <a href={data.explorer_address} target="_blank" rel="noreferrer"><code>{data.wallet}</code> ↗</a>
          </div>
          <div className="vf-scroll">
            <table>
              <thead><tr><th>Memo</th><th>Time (UTC)</th><th>Transaction</th></tr></thead>
              <tbody>
                {txs.map((t) => (
                  <tr key={t.signature}>
                    <td><code>{(t.memo ?? '').replace(/^\[\d+\] /, '')}</code></td>
                    <td>{t.blockTime ? new Date(t.blockTime * 1000).toISOString().slice(5, 16).replace('T', ' ') : '—'}</td>
                    <td><a href={explorerTx(t.signature, data.cluster)} target="_blank" rel="noreferrer">{short(t.signature, 6)}</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!txs.length && <p className="faint">No transactions found for this wallet yet.</p>}
        </div>
      )}
    </div>
  )

  return (
    <div className="vf">
      <Explain question="Was the forecast changed after the fact?" answer={answer} experts={experts} />
      <style>{CSS}</style>
    </div>
  )
}

const CSS = `
.vf { margin-top: 28px; }
.vf .ex { border-radius: 24px; padding: 20px 20px 10px; }
.vf-x p { margin: 0 0 12px; max-width: 720px; }
.vf-rows { display: grid; gap: 8px; }
.vf-scroll { overflow-x: auto; }
.vf-k { font-size: 12px; color: var(--accent); font-weight: 600; }
.vf h2 { margin: 4px 0 6px; font-size: 22px; letter-spacing: -0.02em; }
.vf header p { margin: 0 0 14px; color: var(--text-2); max-width: 720px; }
.vf-card { border: 1px solid var(--line); border-radius: 16px; padding: 14px; display: grid; gap: 10px; font-size: 15px; }
.vf-card.ok { border-color: rgba(197,240,107,.5); }
.vf-card.bad { border-color: #e5534b; }
.vf-row { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; font-size: 13px; }
.vf-row > span { color: var(--text-3); min-width: 150px; }
.vf code { font-size: 12px; word-break: break-all; }
.vf-verdict { font-weight: 600; font-size: 16px; min-height: 22px; }
.vf-card.ok .vf-verdict { color: var(--accent); }
.vf-card.bad .vf-verdict { color: var(--hot); }
.vf-actions { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; font-size: 13px; }
.vf-actions .btn { padding: 8px 14px; border-radius: 999px; background: var(--card); color: var(--text); }
.vf-actions a, .vf-list a { color: var(--text); text-decoration: underline; }
.vf-list { margin-top: 18px; display: grid; gap: 8px; }
.vf table { width: 100%; border-collapse: collapse; font-size: 12px; }
.vf th { text-align: left; color: var(--text-3); font-weight: 500; padding: 4px 8px 4px 0; }
.vf td { padding: 4px 8px 4px 0; border-top: 1px solid var(--line); }
.vf-warn { color: var(--hot); font-size: 13px; margin: 0; }
.vf-verdict b { font-weight: 700; }
.vf-pair { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; align-items: center; }
.vf-fp { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; display: grid; gap: 6px; min-width: 0; }
.vf-fp span { font-size: 12px; color: var(--text-3); }
.vf-fp code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 16px; word-break: break-all; }
.vf-eq { font-size: 40px; font-weight: 700; line-height: 1; color: var(--text-3); text-align: center; min-width: 36px; }
.vf-eq.ok { color: #7fd36b; }
.vf-eq.bad { color: #e5534b; }
.vf-say { margin: 0; font-size: 14px; }
.vf-changed { margin: 0; font-size: 13px; color: #e5534b; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
@media (max-width: 700px) { .vf-pair { grid-template-columns: 1fr; justify-items: stretch; } .vf-eq { padding: 2px 0; } .vf .ex { padding: 14px 14px 8px; border-radius: 18px; } .vf-row > span { min-width: 0; } }
`
