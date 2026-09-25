/** 测试用：手写最小 PDF（未压缩流，Helvetica），字节级构造 xref。仅测试引用。 */

interface TextOp {
  text: string
  x: number
  y: number
  size: number
}

export function buildMinimalPdf(ops: TextOp[]): Buffer {
  const esc = (s: string): string => s.replace(/[\\()]/g, (c) => '\\' + c)
  const content = ops
    .map((op) => `BT /F1 ${op.size} Tf ${op.x} ${op.y} Td (${esc(op.text)}) Tj ET`)
    .join('\n')

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefStart = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}
