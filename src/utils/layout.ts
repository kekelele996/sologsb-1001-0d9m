import type { Cue, LayoutSpec } from '../types'

export interface LayoutViolation {
  kind: 'lineChars' | 'lineCount'
  /** 出问题的行序号（从 1 起）；行数超限时为 null */
  line: number | null
  /** 实际值：每行字数或总行数 */
  actual: number
}

export interface CueLayoutReport {
  cueId: string
  lines: string[]
  violations: LayoutViolation[]
}

export const DEFAULT_LAYOUT: LayoutSpec = { maxLineChars: 20, maxLines: 2 }
export const MIN_LAYOUT_VALUE = 1
export const MAX_LINE_CHARS_LIMIT = 80
export const MAX_LINES_LIMIT = 8

/** 译文按显式换行符分行；无译文时返回空数组 */
export const splitLines = (text: string): string[] => {
  if (!text) return []
  return text.replace(/\r/g, '').split('\n').map((line) => line.replace(/\s+$/g, ''))
}

const isCjk = (ch: string | undefined): boolean => !!ch && /[一-鿿　-〿＀-￯]/.test(ch)
const isAsciiWord = (ch: string | undefined): boolean => !!ch && /[A-Za-z0-9'’\-]/.test(ch)
const isSpace = (ch: string | undefined): boolean => ch === ' ' || ch === '\t'

const BREAK_PUNCTUATION = new Set([
  '，', '。', '！', '？', '；', '、', '：', '…', '—', '～', '）', '】', '」', '』', '》',
  ',', '.', '!', '?', ';', ':', ')', ']',
])

/**
 * 找出文本中的可断点：换行插在断点字符之前，绝不会从英文单词中间切开。
 * 空格与标点后的断点用于优先排序；中文之间、中英文边界同样可断。
 */
function findBreakIndices(text: string): Set<number> {
  const indices = new Set<number>()
  for (let i = 1; i < text.length; i++) {
    const prev = text[i - 1]
    const ch = text[i]
    if (isSpace(prev) && !isSpace(ch)) {
      indices.add(i) // 空格之后：换行时空格被裁掉
    } else if (BREAK_PUNCTUATION.has(prev) && !isSpace(ch)) {
      indices.add(i) // 标点留在上行末尾
    } else if (!isSpace(prev) && !isSpace(ch)) {
      if (isCjk(prev) && isCjk(ch)) indices.add(i)
      else if (isCjk(prev) !== isCjk(ch) || isAsciiWord(prev) !== isAsciiWord(ch)) indices.add(i)
    }
  }
  return indices
}

const INF = Number.POSITIVE_INFINITY
const OVERFLOW_BASE = 1_000_000
const OVERFLOW_STEP = 10_000

/**
 * 动态规划：在可断点中选出 k-1 个，把一行文本切成 k 行。
 * 代价：超长行施加重罚（保证先可行），再用长度平方和衡量各行是否均衡。
 */
function partitionIntoK(text: string, ends: number[], k: number, maxChars: number): number[] | null {
  const n = ends.length - 1 // ends[0]=0, ends[n]=text.length
  if (k > n) return null
  const lengthOf = (p: number, q: number) => Math.max(0, text.slice(ends[p], ends[q]).trim().length)
  const lineCost = (len: number) => len * len + (len > maxChars ? OVERFLOW_BASE + (len - maxChars) * OVERFLOW_STEP : 0)

  const dp: number[][] = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(INF))
  const prev: number[][] = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(-1))
  dp[0][0] = 0
  for (let lines = 1; lines <= k; lines++) {
    for (let q = lines; q <= n; q++) {
      for (let p = lines - 1; p < q; p++) {
        if (dp[lines - 1][p] === INF) continue
        const len = lengthOf(p, q)
        if (len === 0) continue
        const cost = dp[lines - 1][p] + lineCost(len)
        if (cost < dp[lines][q]) {
          dp[lines][q] = cost
          prev[lines][q] = p
        }
      }
    }
  }
  if (dp[k][n] === INF) return null
  const positions: number[] = []
  let q = n
  for (let lines = k; lines >= 1; lines--) {
    positions.unshift(ends[q])
    q = prev[lines][q]
  }
  return positions
}

/** 对单个不含换行的长句做平衡分段 */
function balanceSingleLine(line: string, spec: LayoutSpec): string[] {
  const breaks = findBreakIndices(line)
  const ends = [0, ...[...breaks].sort((a, b) => a - b), line.length]
  // 先用最少行数满足每行字数上限；在同一行数下取最均衡的切法
  for (let k = 1; k <= spec.maxLines; k++) {
    const positions = partitionIntoK(line, ends, k, spec.maxLineChars)
    if (!positions) continue
    const pieces: string[] = []
    let start = 0
    let feasible = true
    for (const end of positions) {
      const piece = line.slice(start, end).trim()
      if (piece.length > spec.maxLineChars) feasible = false
      pieces.push(piece)
      start = end
    }
    if (feasible) return pieces
  }
  // 无法在限制内排下（例如超长英文单词）：用满行数并让超出最少，保留完整单词，交给检查器标红
  const best = partitionIntoK(line, ends, spec.maxLines, spec.maxLineChars)
  if (!best) return [line]
  const pieces: string[] = []
  let start = 0
  for (const end of best) {
    pieces.push(line.slice(start, end).trim())
    start = end
  }
  return pieces.filter(Boolean)
}

/**
 * 一键平衡排版：尊重已有手动换行，只把过长的行按空格、标点及中文边界
 * 排成平衡的多行，不拆断英文单词。
 */
export function balanceText(text: string, spec: LayoutSpec): string {
  const sourceLines = splitLines(text)
  if (!sourceLines.length) return text
  const result: string[] = []
  for (const line of sourceLines) {
    if (line.length <= spec.maxLineChars) {
      result.push(line)
    } else {
      result.push(...balanceSingleLine(line, spec))
    }
  }
  return result.join('\n')
}

export function checkCueLayout(cue: Cue, spec: LayoutSpec): CueLayoutReport {
  const lines = splitLines(cue.target || cue.source)
  const violations: LayoutViolation[] = []
  if (!lines.length || lines.every((line) => !line.trim())) {
    return { cueId: cue.id, lines: [], violations }
  }
  lines.forEach((line, index) => {
    if (line.length > spec.maxLineChars) {
      violations.push({ kind: 'lineChars', line: index + 1, actual: line.length })
    }
  })
  if (lines.length > spec.maxLines) {
    violations.push({ kind: 'lineCount', line: null, actual: lines.length })
  }
  return { cueId: cue.id, lines, violations }
}

export const checkLayout = (cues: Cue[], spec: LayoutSpec): CueLayoutReport[] =>
  cues.map((cue) => checkCueLayout(cue, spec))

export const isLayoutClean = (cues: Cue[], spec: LayoutSpec): boolean =>
  cues.every((cue) => checkCueLayout(cue, spec).violations.length === 0)
