import { getStore } from '@netlify/blobs'
import { createFileRoute } from '@tanstack/react-router'

import {
  DEFAULT_SETTINGS,
  FIELD,
  PLAYER_STATUS_OPTIONS,
  SEEDED_ENTRIES,
  SEEDED_MANUAL_SCORES,
  SEEDED_SETTINGS,
  type Entry,
  type ManualScore,
  type PlayerStatus,
  type PoolSettings,
} from '@/lib/golf-pool-data'

type PoolState = {
  entries: Entry[]
  settings: PoolSettings
  manualScores: Record<string, ManualScore>
}

type BodyPayload =
  | {
      action: 'upsert-entry'
      entry: Omit<Entry, 'id' | 'createdAt'>
    }
  | {
      action: 'delete-entry'
      id: string
    }
  | {
      action: 'save-settings'
      settings: Partial<PoolSettings>
    }
  | {
      action: 'save-manual-scores'
      scores: Record<string, ManualScore>
    }

const ENTRIES_KEY = 'entries'
const SETTINGS_KEY = 'settings'
const SCORES_KEY = 'scores'
const VALID_STATUSES = new Set<PlayerStatus>(PLAYER_STATUS_OPTIONS.map((option) => option.value))

export const Route = createFileRoute('/api/pool')({
  server: {
    handlers: {
      GET: async () => {
        return Response.json(await loadState())
      },
      POST: async ({ request }) => {
        const body = (await request.json()) as BodyPayload
        if (!body || typeof body !== 'object' || !('action' in body)) {
          return Response.json({ error: 'Invalid payload' }, { status: 400 })
        }

        switch (body.action) {
          case 'upsert-entry': {
            if (!body.entry || typeof body.entry.name !== 'string') {
              return Response.json({ error: 'Invalid entry payload' }, { status: 400 })
            }

            const entries = await getEntries()
            const sanitized = sanitizeEntryDraft(body.entry)
            if (!sanitized) {
              return Response.json({ error: 'Invalid entry data' }, { status: 400 })
            }

            const normalizedName = sanitized.name.trim()
            const existingIndex = entries.findIndex(
              (entry) => entry.name.toLowerCase() === normalizedName.toLowerCase(),
            )

            if (existingIndex >= 0) {
              const current = entries[existingIndex]
              entries[existingIndex] = {
                ...current,
                ...sanitized,
                name: normalizedName,
              }
            } else {
              entries.push({
                ...sanitized,
                id: crypto.randomUUID(),
                name: normalizedName,
                createdAt: new Date().toISOString(),
              })
            }

            if (!(await writeStoreJSON(ENTRIES_KEY, entries))) {
              return Response.json({ error: 'Unable to save entries right now' }, { status: 503 })
            }

            return Response.json(await loadState())
          }

          case 'delete-entry': {
            const nextEntries = (await getEntries()).filter((entry) => entry.id !== body.id)
            if (!(await writeStoreJSON(ENTRIES_KEY, nextEntries))) {
              return Response.json({ error: 'Unable to delete entry right now' }, { status: 503 })
            }

            return Response.json(await loadState())
          }

          case 'save-settings': {
            const current = await getSettings()
            const merged = normalizeSettings({
              ...current,
              ...body.settings,
            })

            if (!(await writeStoreJSON(SETTINGS_KEY, merged))) {
              return Response.json({ error: 'Unable to save settings right now' }, { status: 503 })
            }

            return Response.json(await loadState())
          }

          case 'save-manual-scores': {
            const sanitized: Record<string, ManualScore> = {}
            for (const name of FIELD) {
              const score = body.scores?.[name]
              if (!score) continue
              sanitized[name] = normalizeManualScore(score)
            }

            if (!(await writeStoreJSON(SCORES_KEY, sanitized))) {
              return Response.json({ error: 'Unable to save scores right now' }, { status: 503 })
            }

            return Response.json(await loadState())
          }

          default:
            return Response.json({ error: 'Unsupported action' }, { status: 400 })
        }
      },
    },
  },
})

async function loadState(): Promise<PoolState> {
  const [entries, settings, manualScores] = await Promise.all([
    getEntries(),
    getSettings(),
    getManualScores(),
  ])

  return {
    entries,
    settings,
    manualScores,
  }
}

function getPoolStore() {
  return getStore({ name: 'golf-pool' })
}

async function readStoreJSON<T>(key: string): Promise<T | undefined> {
  try {
    const value = await getPoolStore().get(key, { type: 'json' })
    return value === null || value === undefined ? undefined : (value as T)
  } catch (error) {
    console.error(`[pool] Unable to read ${key} from Netlify Blobs`, error)
    return undefined
  }
}

async function writeStoreJSON(key: string, value: unknown): Promise<boolean> {
  try {
    await getPoolStore().setJSON(key, value)
    return true
  } catch (error) {
    console.error(`[pool] Unable to write ${key} to Netlify Blobs`, error)
    return false
  }
}

async function getEntries(): Promise<Entry[]> {
  const entries = await readStoreJSON<unknown[]>(ENTRIES_KEY)
  if (!entries) return SEEDED_ENTRIES
  if (!Array.isArray(entries)) return []

  return entries
    .map((entry) => normalizeEntry(entry))
    .filter((entry): entry is Entry => entry !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

async function getSettings(): Promise<PoolSettings> {
  const settings = await readStoreJSON<unknown>(SETTINGS_KEY)
  if (!settings || typeof settings !== 'object') {
    return { ...SEEDED_SETTINGS }
  }

  return normalizeSettings(settings as Partial<PoolSettings>)
}

async function getManualScores(): Promise<Record<string, ManualScore>> {
  const manualScores = await readStoreJSON<Record<string, unknown>>(SCORES_KEY)
  if (!manualScores || typeof manualScores !== 'object') return SEEDED_MANUAL_SCORES

  const normalized: Record<string, ManualScore> = {}
  for (const name of FIELD) {
    const rawScore = manualScores[name]
    if (!rawScore) continue
    normalized[name] = normalizeManualScore(rawScore)
  }

  return Object.keys(normalized).length > 0 ? normalized : SEEDED_MANUAL_SCORES
}

function normalizeEntry(raw: unknown): Entry | null {
  if (!raw || typeof raw !== 'object') return null

  const record = raw as Partial<Entry>
  const draft = sanitizeEntryDraft({
    name: typeof record.name === 'string' ? record.name : '',
    pick1: typeof record.pick1 === 'string' ? record.pick1 : '',
    pick2: typeof record.pick2 === 'string' ? record.pick2 : '',
    pick3: typeof record.pick3 === 'string' ? record.pick3 : '',
    pick4: typeof record.pick4 === 'string' ? record.pick4 : '',
    winnerPick: typeof record.winnerPick === 'string' ? record.winnerPick : null,
    alternate: typeof record.alternate === 'string' ? record.alternate : null,
    tiebreaker:
      typeof record.tiebreaker === 'number'
        ? record.tiebreaker
        : typeof record.tiebreaker === 'string'
          ? Number.parseInt(record.tiebreaker, 10)
          : null,
  })

  if (!draft) return null

  return {
    ...draft,
    id: typeof record.id === 'string' ? record.id : crypto.randomUUID(),
    createdAt:
      typeof record.createdAt === 'string' && record.createdAt.trim().length > 0
        ? record.createdAt
        : new Date().toISOString(),
  }
}

function sanitizeEntryDraft(entry: Omit<Entry, 'id' | 'createdAt'>): Omit<Entry, 'id' | 'createdAt'> | null {
  const picks = [entry.pick1, entry.pick2, entry.pick3, entry.pick4].map((pick) => pick.trim())
  if (entry.name.trim().length === 0 || picks.some((pick) => !FIELD.includes(pick))) {
    return null
  }

  const uniquePicks = new Set(picks)
  if (uniquePicks.size !== picks.length) return null

  const winnerPick =
    typeof entry.winnerPick === 'string' && picks.includes(entry.winnerPick.trim())
      ? entry.winnerPick.trim()
      : null

  const alternateCandidate = typeof entry.alternate === 'string' ? entry.alternate.trim() : ''
  const alternate =
    alternateCandidate.length > 0
    && FIELD.includes(alternateCandidate)
    && !picks.includes(alternateCandidate)
      ? alternateCandidate
      : null

  const parsedTiebreaker =
    entry.tiebreaker === null || entry.tiebreaker === undefined
      ? null
      : Number(entry.tiebreaker)

  return {
    name: entry.name.trim(),
    pick1: picks[0],
    pick2: picks[1],
    pick3: picks[2],
    pick4: picks[3],
    winnerPick,
    alternate,
    tiebreaker: Number.isNaN(parsedTiebreaker) ? null : parsedTiebreaker,
  }
}

function normalizeSettings(settings: Partial<PoolSettings>): PoolSettings {
  return {
    picksOpen:
      typeof settings.picksOpen === 'boolean'
        ? settings.picksOpen
        : SEEDED_SETTINGS.picksOpen,
    tournamentWinner:
      typeof settings.tournamentWinner === 'string' && settings.tournamentWinner.trim().length > 0
        ? settings.tournamentWinner
        : null,
    cutLine:
      typeof settings.cutLine === 'number' && !Number.isNaN(settings.cutLine)
        ? settings.cutLine
        : DEFAULT_SETTINGS.cutLine,
  }
}

function normalizeManualScore(rawScore: unknown): ManualScore {
  const record = rawScore as Partial<ManualScore & { mc?: boolean }>
  const status = VALID_STATUSES.has(record.status as PlayerStatus)
    ? (record.status as PlayerStatus)
    : record.mc
      ? 'missed_cut'
      : 'active'

  return {
    topar:
      record.topar === null || record.topar === undefined || Number.isNaN(Number(record.topar))
        ? null
        : Number(record.topar),
    status,
  }
}
