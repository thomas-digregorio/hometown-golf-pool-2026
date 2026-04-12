import { getStore } from '@netlify/blobs'
import { createFileRoute } from '@tanstack/react-router'

import {
  DEFAULT_SETTINGS,
  FIELD,
  SEEDED_ENTRIES,
  SEEDED_MANUAL_SCORES,
  type Entry,
  type ManualScore,
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

const store = getStore({
  name: 'golf-pool',
  consistency: 'strong',
})

const ENTRIES_KEY = 'entries'
const SETTINGS_KEY = 'settings'
const SCORES_KEY = 'scores'
const RETRY_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 75
const FIELD_SET = new Set(FIELD)

export const Route = createFileRoute('/api/pool')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const state = await loadState()
          return Response.json(state)
        } catch {
          return Response.json({ error: 'Unable to load pool state' }, { status: 500 })
        }
      },
      POST: async ({ request }) => {
        let body: BodyPayload | null = null
        try {
          body = (await request.json()) as BodyPayload
        } catch {
          return Response.json({ error: 'Invalid JSON payload' }, { status: 400 })
        }

        if (!body || typeof body !== 'object' || !('action' in body)) {
          return Response.json({ error: 'Invalid payload' }, { status: 400 })
        }

        try {
          switch (body.action) {
            case 'upsert-entry': {
              const validation = validateUpsertEntry(body.entry)
              if (!validation.valid) {
                return Response.json({ error: validation.error }, { status: 400 })
              }

              const entryPayload = validation.entry
              const entries = await getEntries()
              const normalizedName = entryPayload.name.trim()
              const existingIndex = entries.findIndex(
                (entry) => entry.name.toLowerCase() === normalizedName.toLowerCase(),
              )

              if (existingIndex >= 0) {
                const current = entries[existingIndex]
                entries[existingIndex] = {
                  ...current,
                  ...entryPayload,
                  name: normalizedName,
                }
              } else {
                entries.push({
                  ...entryPayload,
                  id: crypto.randomUUID(),
                  name: normalizedName,
                  createdAt: new Date().toISOString(),
                })
              }

              await saveEntries(entries)
              return Response.json(await loadState())
            }

            case 'delete-entry': {
              if (typeof body.id !== 'string' || body.id.trim().length === 0) {
                return Response.json({ error: 'Invalid entry id' }, { status: 400 })
              }

              const nextEntries = (await getEntries()).filter((entry) => entry.id !== body.id)
              await saveEntries(nextEntries)
              return Response.json(await loadState())
            }

            case 'save-settings': {
              const sanitizedSettings = sanitizeSettings(body.settings)
              if (!sanitizedSettings.valid) {
                return Response.json({ error: sanitizedSettings.error }, { status: 400 })
              }

              const current = await getSettings()
              const merged: PoolSettings = {
                ...current,
                ...sanitizedSettings.settings,
              }

              await setStoreJSON(SETTINGS_KEY, merged)
              return Response.json(await loadState())
            }

            case 'save-manual-scores': {
              if (!body.scores || typeof body.scores !== 'object') {
                return Response.json({ error: 'Invalid manual scores payload' }, { status: 400 })
              }

              const sanitized: Record<string, ManualScore> = {}
              for (const name of FIELD) {
                const score = body.scores?.[name]
                if (!score || typeof score !== 'object') continue
                const normalizedTopar =
                  score.topar === null || score.topar === undefined || Number.isNaN(Number(score.topar))
                    ? null
                    : Number(score.topar)

                sanitized[name] = {
                  topar: Number.isFinite(normalizedTopar) ? normalizedTopar : null,
                  mc: Boolean(score.mc),
                }
              }

              await setStoreJSON(SCORES_KEY, sanitized)
              return Response.json(await loadState())
            }

            default:
              return Response.json({ error: 'Unsupported action' }, { status: 400 })
          }
        } catch {
          return Response.json({ error: 'Unable to update pool state' }, { status: 500 })
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

async function getEntries(): Promise<Entry[]> {
  const entries = await getStoreJSON(ENTRIES_KEY)
  if (entries === null || entries === undefined) return SEEDED_ENTRIES
  if (!Array.isArray(entries)) return []

  return entries
    .filter((entry): entry is Entry => isEntry(entry))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

async function saveEntries(entries: Entry[]): Promise<void> {
  await setStoreJSON(ENTRIES_KEY, entries)
}

async function getSettings(): Promise<PoolSettings> {
  const settings = await getStoreJSON(SETTINGS_KEY)
  if (!settings || typeof settings !== 'object') {
    return { ...DEFAULT_SETTINGS }
  }
  const parsed = settings as Record<string, unknown>

  return {
    picksOpen:
      typeof parsed.picksOpen === 'boolean'
        ? parsed.picksOpen
        : DEFAULT_SETTINGS.picksOpen,
    tournamentWinner:
      typeof parsed.tournamentWinner === 'string'
        ? parsed.tournamentWinner
        : null,
    cutLine:
      typeof parsed.cutLine === 'number'
        ? parsed.cutLine
        : DEFAULT_SETTINGS.cutLine,
  }
}

async function getManualScores(): Promise<Record<string, ManualScore>> {
  const manualScores = await getStoreJSON(SCORES_KEY)
  if (manualScores === null || manualScores === undefined) return SEEDED_MANUAL_SCORES
  if (!manualScores || typeof manualScores !== 'object') return {}

  const normalized: Record<string, ManualScore> = {}
  for (const name of FIELD) {
    const rawScore = (manualScores as Record<string, ManualScore | undefined>)[name]
    if (!rawScore) continue

    normalized[name] = {
      topar:
        rawScore.topar === null || rawScore.topar === undefined
          ? null
          : Number(rawScore.topar),
      mc: Boolean(rawScore.mc),
    }
  }

  return normalized
}

type ValidationResult =
  | { valid: true; entry: Omit<Entry, 'id' | 'createdAt'> }
  | { valid: false; error: string }

function validateUpsertEntry(entry: unknown): ValidationResult {
  if (!entry || typeof entry !== 'object') {
    return { valid: false, error: 'Invalid entry payload' }
  }

  const candidate = entry as Record<string, unknown>
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
  const pick1 = typeof candidate.pick1 === 'string' ? candidate.pick1.trim() : ''
  const pick2 = typeof candidate.pick2 === 'string' ? candidate.pick2.trim() : ''
  const pick3 = typeof candidate.pick3 === 'string' ? candidate.pick3.trim() : ''
  const pick4 = typeof candidate.pick4 === 'string' ? candidate.pick4.trim() : ''
  const tiebreaker = candidate.tiebreaker

  if (!name) return { valid: false, error: 'Entry name is required' }
  if (!FIELD_SET.has(pick1) || !FIELD_SET.has(pick2) || !FIELD_SET.has(pick3) || !FIELD_SET.has(pick4)) {
    return { valid: false, error: 'One or more picks are invalid' }
  }

  const uniquePicks = new Set([pick1, pick2, pick3, pick4])
  if (uniquePicks.size !== 4) {
    return { valid: false, error: 'Duplicate picks are not allowed' }
  }

  const parsedTiebreaker = tiebreaker === null || tiebreaker === undefined
    ? null
    : Number.parseInt(String(tiebreaker), 10)
  if (parsedTiebreaker === null || Number.isNaN(parsedTiebreaker)) {
    return { valid: false, error: 'Tiebreaker must be an integer' }
  }

  return {
    valid: true,
    entry: {
      name,
      pick1,
      pick2,
      pick3,
      pick4,
      tiebreaker: parsedTiebreaker,
    },
  }
}

type SettingsValidationResult =
  | { valid: true; settings: Partial<PoolSettings> }
  | { valid: false; error: string }

function sanitizeSettings(input: unknown): SettingsValidationResult {
  if (!input || typeof input !== 'object') {
    return { valid: false, error: 'Invalid settings payload' }
  }

  const raw = input as Record<string, unknown>
  const next: Partial<PoolSettings> = {}

  if ('picksOpen' in raw) {
    if (typeof raw.picksOpen !== 'boolean') {
      return { valid: false, error: 'picksOpen must be a boolean' }
    }
    next.picksOpen = raw.picksOpen
  }

  if ('tournamentWinner' in raw) {
    if (raw.tournamentWinner !== null && typeof raw.tournamentWinner !== 'string') {
      return { valid: false, error: 'tournamentWinner must be a string or null' }
    }

    if (typeof raw.tournamentWinner === 'string') {
      const trimmed = raw.tournamentWinner.trim()
      if (trimmed.length > 0 && !FIELD_SET.has(trimmed)) {
        return { valid: false, error: 'tournamentWinner must be in the field list' }
      }
      next.tournamentWinner = trimmed.length > 0 ? trimmed : null
    } else {
      next.tournamentWinner = null
    }
  }

  if ('cutLine' in raw) {
    const cutLine = Number(raw.cutLine)
    if (!Number.isFinite(cutLine)) {
      return { valid: false, error: 'cutLine must be a number' }
    }
    next.cutLine = Math.trunc(cutLine)
  }

  return { valid: true, settings: next }
}

function isEntry(entry: unknown): entry is Entry {
  if (!entry || typeof entry !== 'object') return false
  const candidate = entry as Record<string, unknown>

  return (
    typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.pick1 === 'string'
    && typeof candidate.pick2 === 'string'
    && typeof candidate.pick3 === 'string'
    && typeof candidate.pick4 === 'string'
    && (typeof candidate.tiebreaker === 'number' || candidate.tiebreaker === null)
    && typeof candidate.createdAt === 'string'
  )
}

async function getStoreJSON(key: string): Promise<unknown> {
  return withRetry(() => store.get(key, { type: 'json' }))
}

async function setStoreJSON(key: string, value: unknown): Promise<void> {
  await withRetry(() => store.setJSON(key, value))
}

async function withRetry<T>(operation: () => Promise<T>, attempt = 0): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (attempt >= RETRY_ATTEMPTS - 1) throw error

    const delay = RETRY_BASE_DELAY_MS * 2 ** attempt
    await new Promise((resolve) => setTimeout(resolve, delay))
    return withRetry(operation, attempt + 1)
  }
}
