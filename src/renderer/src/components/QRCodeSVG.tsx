import { useMemo } from 'react'
import QRCode from 'qrcode'

/** Renders a QR code as inline SVG (vector, so it prints crisply and scans reliably). */
export function QRCodeSVG({
  value,
  size
}: {
  value: string
  size: number | string
}): React.JSX.Element {
  const { path, n } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' })
    const n = qr.modules.size
    let d = ''
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) if (qr.modules.get(x, y)) d += `M${x + 4},${y + 4}h1v1h-1z`
    return { path: d, n }
  }, [value])
  const box = n + 8 // 4-module quiet zone each side, required for reliable scanning
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${box} ${box}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`QR code ${value}`}
    >
      <rect width={box} height={box} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  )
}
