import type { LayoutIssue, LayoutLine, LayoutSpec } from '../types'

export const DEFAULT_LAYOUT_SPEC: LayoutSpec = { maxCharsPerLine: 18, maxLines: 2 }

export const clampLayoutSpec = (spec: Partial<LayoutSpec> | undefined): LayoutSpec => ({
  maxCharsPerLine: Math.min(60, Math.max(4, Math.round(spec?.maxCharsPerLine ?? DEFAULT_LAYOUT_SPEC.maxCharsPerLine))),
  maxLines: Math.min(6, Math.max(1, Math.round(spec?.maxLines ?? DEFAULT_LAYOUT_SPEC.maxLines))),
})

/** 宽字符（中文、日文假名、韩文及全角标点）按 1 计宽，半角字符按 0.5 计宽 */
export const charWidth = (char: string): number => {
  const code = char.codePointAt(0) ?? 0
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd)
  ) return 1
  if (/\s/.test(char)) return 0
  return 0.5
}

export const textWidth = (text: string): number => {
  let width = 0
  for (const char of text) width += charWidth(char)
  return Math.round(width)
}

/** 按手动换行符拆分译文，空行忽略、行首尾空白忽略 */
export const splitLines = (text: string): string[] => {
  if (!text) return []
  return text.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean)
}

export interface LayoutCheckResult {
  lines: LayoutLine[]
  issues: LayoutIssue[]
  lineCount: number
  passes: boolean
}

export const checkLayout = (text: string, spec: LayoutSpec): LayoutCheckResult => {
  const lines = splitLines(text).map((line) => {
    const width = textWidth(line)
    return { text: line, width, over: width > spec.maxCharsPerLine }
  })
  const issues: LayoutIssue[] = []
  lines.forEach((line, index) => {
    if (line.over) issues.push({ cueId: '', reason: 'lineOverflow', lineIndex: index, width: line.width })
  })
  if (lines.length > spec.maxLines) issues.push({ cueId: '', reason: 'tooManyLines', lineCount: lines.length })
  return { lines, issues, lineCount: lines.length, passes: issues.length === 0 }
}

// ---------- 自动平衡断行 ----------

type TokenType = 'word' | 'wide' | 'punct'
interface Token { type: TokenType; text: string }
interface Atom extends Token { width: number; gapBefore: boolean }

const isOpenBracket = (char: string): boolean => /[[(｛{【《「『“‘"'’]/.test(char)
const isClosePunct = (char: string): boolean => /[!?,;:…—～~！？，、。；：）)】》」』”’]/.test(char)

const tokenize = (text: string): { tokens: Token[]; gaps: Set<number> } => {
  const raw = text.match(/\s+|[A-Za-z0-9À-ɏ]+(?:['’\-./][A-Za-z0-9À-ɏ]+)*|./gu) ?? []
  const tokens: Token[] = []
  const gaps = new Set<number>()
  let pendingSpace = false
  for (const piece of raw) {
    if (/^\s+$/.test(piece)) { pendingSpace = true; continue }
    if (pendingSpace && tokens.length) gaps.add(tokens.length)
    pendingSpace = false
    let type: TokenType
    if (/[A-Za-z0-9À-ɏ]/.test(piece[0])) type = 'word'
    else if (/\p{P}|\p{S}/u.test(piece)) type = 'punct'
    else type = 'wide'
    tokens.push({ type, text: piece })
  }
  return { tokens, gaps }
}

/** 两个内容原子之间是否允许断行：英文单词及其紧跟标点不拆开，其余按空格、标点、中文边界允许断开 */
const canBreakAt = (atoms: Atom[], index: number): boolean => {
  const left = atoms[index - 1]
  const right = atoms[index]
  if (!left || !right) return false
  // 开引号 / 开括号不能与后续内容分离
  if (left.type === 'punct' && isOpenBracket(left.text)) return false
  // 闭引号 / 闭括号不能与前半句话分离
  if (right.type === 'punct' && isOpenBracket(right.text)) return false
  if (right.type === 'punct' && isClosePunct(right.text)) return false
  // 英文单词内部及单词与紧贴标点之间不拆（避免把英文单词拆散）
  if (left.type === 'word' && (right.type === 'word' || right.type === 'punct')) return right.gapBefore
  // 中文与其他内容的边界、标点之后均可断
  return true
}

const isCjk = (atom: Atom) => atom.type === 'wide'

/**
 * 把长句排成平衡的多行。
 * 以空格、标点、中文边界为断点做动态规划：优先单行，其次尽量不超行宽，
 * 再在不超宽的前提下让各行长度均衡；实在排不下（如超长英文单词）才允许溢出。
 */
export const balanceText = (input: string, spec: LayoutSpec): string => {
  const normalized = input.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  const { tokens, gaps } = tokenize(normalized)
  if (!tokens.length) return ''
  const atoms: Atom[] = tokens.map((token, index) => ({ ...token, width: textWidth(token.text), gapBefore: gaps.has(index) }))

  const maxChars = spec.maxCharsPerLine
  const prefix = [0]
  atoms.forEach((atom, index) => { prefix.push(prefix[index] + (atom.gapBefore ? 0.5 : 0) + atom.width) })
  // 某一行放置 atoms[i..j]（含原子间原有空格）后的宽度
  const rangeWidth = (i: number, j: number): number =>
    Math.round(prefix[j + 1] - prefix[i] - (atoms[i].gapBefore ? 0.5 : 0))

  interface State { cost: number; breaks: number[] }
  const INFINITY = Number.POSITIVE_INFINITY
  // dp[j]：前 j 个原子已排完的最优状态
  const dp: State[] = [{ cost: 0, breaks: [] }]
  const linePenalty = (maxChars + 2) ** 2
  for (let j = 1; j <= atoms.length; j++) {
    let bestCost = INFINITY
    let bestBreaks: number[] = []
    for (let i = 0; i < j; i++) {
      if (dp[i].cost === INFINITY) continue
      if (i > 0 && !canBreakAt(atoms, i)) continue
      const width = rangeWidth(i, j - 1)
      const overflow = Math.max(0, width - maxChars)
      const slack = maxChars - width
      const cost = dp[i].cost + (overflow ? 1_000_000 * overflow * overflow : 0) + linePenalty + slack * slack
      if (cost < bestCost) { bestCost = cost; bestBreaks = [...dp[i].breaks, i] }
    }
    dp[j] = { cost: bestCost, breaks: bestBreaks }
  }

  const boundaries = dp[atoms.length].breaks.slice(1) // 首个断点 0 是行首，去掉
  const segments: Atom[][] = []
  let start = 0
  for (const boundary of boundaries) {
    segments.push(atoms.slice(start, boundary))
    start = boundary
  }
  segments.push(atoms.slice(start))

  return segments.map((segment) =>
    segment.map((atom, index) => {
      if (index === 0) return atom.text
      const prev = segment[index - 1]
      if (atom.gapBefore) return ` ${atom.text}`
      // 中文与半角词之间补半角空格，保持原有书写习惯；标点不补
      if (atom.type !== 'punct' && prev.type !== 'punct' && isCjk(atom) !== isCjk(prev)) return ` ${atom.text}`
      return atom.text
    }).join(''),
  ).join('\n')
}
