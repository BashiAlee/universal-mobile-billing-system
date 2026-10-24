import { useLayoutEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'

/**
 * Code 128 barcode as SVG (readable by any USB/handheld scanner, encodes any text such as P-000123).
 * It stretches to fill its CSS box, so callers control the printed size in mm.
 */
export function BarcodeSVG({
  value,
  width = '100%',
  height = '100%'
}: {
  value: string
  width?: number | string
  height?: number | string
}): React.JSX.Element {
  const ref = useRef<SVGSVGElement>(null)
  useLayoutEffect(() => {
    const svg = ref.current
    if (!svg) return
    JsBarcode(svg, value, {
      format: 'CODE128',
      displayValue: false,
      margin: 10, // quiet zone either side (units of the bar width), needed for reliable scanning
      width: 2,
      height: 60
    })
    // JsBarcode reports sizes like "246px"; a viewBox needs bare numbers.
    const w = parseFloat(svg.getAttribute('width') ?? '')
    const h = parseFloat(svg.getAttribute('height') ?? '')
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
    svg.setAttribute('preserveAspectRatio', 'none')
    svg.removeAttribute('width')
    svg.removeAttribute('height')
    svg.style.width = typeof width === 'number' ? `${width}px` : width
    svg.style.height = typeof height === 'number' ? `${height}px` : height
  }, [value, width, height])
  return <svg ref={ref} role="img" aria-label={`Barcode ${value}`} shapeRendering="crispEdges" />
}
