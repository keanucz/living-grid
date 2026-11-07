import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

function QrCard() {
  const url = `${location.origin}${location.pathname}#/household`
  const [src, setSrc] = useState(null)
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 168, color: { dark: '#121212', light: '#f2f2ef' } }).then(setSrc).catch(() => setSrc(null))
  }, [url])
  return (
    <a className="panel qrcard fade-in" href="#/household">
      {src && <img src={src} alt="QR code for the household view" width="84" height="84" />}
      <div>
        <div className="qr-t">On a tariff that changes through the day?</div>
        <div className="qr-s">Scan for the cheapest hours tonight to charge your car or run the dishwasher.</div>
      </div>
      <style>{`
        .qrcard { display: flex; gap: 14px; align-items: center; width: 560px; padding: 12px; color: inherit; text-decoration: none; }
        .qrcard img { border-radius: 10px; flex: none; }
        .qr-t { font-weight: 600; margin-bottom: 4px; }
        .qr-s { font-size: 12px; color: var(--text-2); line-height: 1.4; }
      `}</style>
    </a>
  )
}

export default { id: 'qr', slot: 'bottomRight', order: 2, modes: ['overview'], Component: QrCard }
