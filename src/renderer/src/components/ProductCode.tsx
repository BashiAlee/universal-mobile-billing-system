import type { ShopSettings } from '../../../shared/types'
import { BarcodeSVG } from './BarcodeSVG'
import { QRCodeSVG } from './QRCodeSVG'

/** Shows a product's code as a barcode or QR, according to the shop's label setting. Sizes are CSS lengths. */
export function ProductCode({
  value,
  type,
  width,
  height
}: {
  value: string
  type: ShopSettings['labelCodeType']
  width: string
  height: string
}): React.JSX.Element {
  if (type === 'qr') {
    // A QR code is square, so it uses the smaller side of the box.
    const side = parseFloat(width) < parseFloat(height) ? width : height
    return <QRCodeSVG value={value} size={side} />
  }
  return <BarcodeSVG value={value} width={width} height={height} />
}
