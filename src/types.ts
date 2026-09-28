export type CueStatus = 'draft' | 'reviewed' | 'issue'
export type Locale = 'zh-CN' | 'en-US' | 'ja-JP'

export interface Cue {
  id: string
  start: number
  end: number
  source: string
  target: string
  actorId: string
  speed: number
  termIds: string[]
  status: CueStatus
  locked: boolean
}

export interface Actor {
  id: string
  name: string
  color: string
  localeHint: string
}

export interface Term {
  id: string
  source: string
  target: string
  note: string
}

export interface Snapshot {
  id: string
  name: string
  createdAt: number
  cues: Cue[]
}

export interface LayoutSpec {
  /** 每行最多字数（中文按 1 字、英文等半角字符按 0.5 字计宽） */
  maxCharsPerLine: number
  /** 每条译文最多行数 */
  maxLines: number
}

export type LayoutReason = 'lineOverflow' | 'tooManyLines'

export interface LayoutLine {
  text: string
  width: number
  over: boolean
}

export interface LayoutIssue {
  cueId: string
  reason: LayoutReason
  lineIndex?: number
  width?: number
  lineCount?: number
}

export interface EditorDocument {
  id: string
  title: string
  language: Locale
  layoutSpec: LayoutSpec
  cues: Cue[]
  actors: Actor[]
  terms: Term[]
  snapshots: Snapshot[]
  updatedAt: number
  revision: number
  lastWriter: string
}

export interface CueConflict {
  cueId: string
  type: 'actor' | 'tone' | 'address'
  message: string
}

export interface HistoryEntry {
  label: string
  cues: Cue[]
  selectedCueId: string | null
}
