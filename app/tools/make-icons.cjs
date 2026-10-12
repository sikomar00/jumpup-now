// 앱 아이콘 생성기 (디자인 시스템 v1, 로고 C: 계단 한 칸과 화살표).
//   node tools/make-icons.cjs
// 외부 의존 없이 직접 래스터화해 PNG를 만든다(선 위주 도형을 거리장으로 그리고 4x4 슈퍼샘플링으로 안티앨리어싱).
//   build/icon.png            256px, 3단 (electron-builder가 .ico 생성에 사용)
//   src/main/iconData.ts      창 아이콘 64px(3단) + 트레이 32px(2단 전용 변형)을 base64로 내장
// 16px 트레이에서는 3단이 뭉개지므로 2단·굵은 선 변형을 쓴다.
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const ACCENT = [0x2b, 0x66, 0xe3]
const WHITE = [255, 255, 255]

/** viewBox 64 기준 도형 */
const C3 = { lines: [[[12, 49], [25, 49], [25, 37], [37, 37], [37, 25]], [[31, 31], [37, 25], [43, 31]]] }
const C2 = { lines: [[[14, 49], [29, 49], [29, 35], [44, 35], [44, 19]], [[37, 26], [44, 19], [51, 26]]] }

function segments(shape) {
  const out = []
  for (const poly of shape.lines) for (let i = 0; i < poly.length - 1; i++) out.push([poly[i], poly[i + 1]])
  return out
}
function distToSegment(px, py, [[ax, ay], [bx, by]]) {
  const dx = bx - ax, dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
function inRoundRect(px, py, r) {
  const dx = Math.max(Math.abs(px - 32) - (32 - r), 0)
  const dy = Math.max(Math.abs(py - 32) - (32 - r), 0)
  return dx * dx + dy * dy <= r * r
}

function render(size, shape, strokeWidth) {
  const segs = segments(shape)
  const SS = 4
  const px = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = ((x + (sx + 0.5) / SS) * 64) / size
          const uy = ((y + (sy + 0.5) / SS) * 64) / size
          if (!inRoundRect(ux, uy, 15)) continue
          const glyph = segs.some((s) => distToSegment(ux, uy, s) <= strokeWidth / 2)
          const c = glyph ? WHITE : ACCENT
          r += c[0]; g += c[1]; b += c[2]; a += 1
        }
      }
      const i = (y * size + x) * 4
      if (a > 0) {
        px[i] = Math.round(r / a); px[i + 1] = Math.round(g / a); px[i + 2] = Math.round(b / a)
        px[i + 3] = Math.round((a / (SS * SS)) * 255)
      }
    }
  }
  return encodePng(size, px)
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const root = path.join(__dirname, '..')
const icon256 = render(256, C3, 5)
const icon64 = render(64, C3, 5.5)
const tray32 = render(32, C2, 7)

fs.mkdirSync(path.join(root, 'build'), { recursive: true })
fs.writeFileSync(path.join(root, 'build', 'icon.png'), icon256)
fs.writeFileSync(
  path.join(root, 'src', 'main', 'iconData.ts'),
  `// 자동 생성 파일 — 직접 수정하지 말고 \`node tools/make-icons.cjs\`로 다시 만든다.
// 디자인 시스템 v1 로고 C(계단 한 칸과 화살표). 창 아이콘은 3단 64px, 트레이는 2단 전용 변형 32px.
export const APP_ICON_64_BASE64 = '${icon64.toString('base64')}'
export const TRAY_ICON_32_BASE64 = '${tray32.toString('base64')}'
`
)
console.log(`build/icon.png ${icon256.length}B · app64 ${icon64.length}B · tray32 ${tray32.length}B`)
