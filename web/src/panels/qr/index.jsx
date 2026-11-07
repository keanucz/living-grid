import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

function QrCard() {
  const url = `${location.origin}${location.pathname}#/household`
  const [src, setSrc] = useState(null)
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 112, color: { dark: '#0a0a0a', light: '#fafafa' } }).then(setSrc).catch(() => setSrc(null))
  }, [url])
  return (
    <a className="panel qrcard fade-in" href="#/household">
      {src && <img src={src} alt="QR code for the household view" width="48" height="48" />}
      <div className="qr-t">Cheapest hours tonight, for your region</div>
      <span className="tag">Scan · phone</span>
      <style>{`
        .qrcard { display: flex; gap: 12px; align-items: center; padding: 8px 12px 8px 8px; color: inherit; text-decoration: none; }
        .qrcard img { border-radius: 4px; flex: none; }
        .qr-t { flex: 1; font-weight: 500; letter-spacing: -0.01em; }
      `}</style>
    </a>
  )
}

export default { id: 'qr', slot: 'bottomRight', order: 2, modes: ['overview'], Component: QrCard }
