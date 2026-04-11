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

export const Route = createFileRoute('/api/pool')({
  server: {
    handlers: {
      GET: async () => {
        const state = await loadState()
        return Response.json(state)
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
            const normalizedName = body.entry.name.trim()
            const existingIndex = entries.findIndex(
              (entry) => entry.name.toLowerCase() === normalizedName.toLowerCase(),
            )

            if (existingIndex >= 0) {
              const current = entries[existingIndex]
              entries[existingIndex] = {
                ...current,
                ...body.entry,
                name: normalizedName,
                winnerPick:
                  typeof body.entry.winnerPick === 'string' && body.entry.winnerPick.length > 0
                    ? body.entry.winnerPick
                    : null,
              }
            } else {
              entries.push({
                ...body.entry,
                id: crypto.randomUUID(),
                name: normalizedName,
                winnerPick:
                  typeof body.entry.winnerPick === 'string' && body.entry.winnerPick.length > 0
                    ? body.entry.winnerPick
                    : null,
                createdAt: new Date().toISOString(),
              })
            }

            await saveEntries(entries)
            return Response.json(await loadState())
          }

          case 'delete-entry': {
            const nextEntries = (await getEntries()).filter((entry) => entry.id !== body.id)
            await saveEntries(nextEntries)
            return Response.json(await loadState())
          }

          case 'save-settings': {
            const current = await getSettings()
            const merged: PoolSettings = {
              ...current,
              ...body.settings,
            }

            await store.setJSON(SETTINGS_KEY, merged)
            return Response.json(await loadState())
          }

          case 'save-manual-scores': {
            const sanitized: Record<string, ManualScore> = {}
            for (const name of FIELD) {
              const score = body.scores?.[name]
              if (!score) continue
              sanitized[name] = {
                topar:
                  score.topar === null || Number.isNaN(score.topar)
                    ? null
                    : Number(score.topar),
                mc: Boolean(score.mc),
                wd: Boolean(score.wd),
                wdAfterCut: Boolean(score.wdAfterCut),
              }
            }

            await store.setJSON(SCORES_KEY, sanitized)
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

async function getEntries(): Promise<Entry[]> {
  const entries = await store.get(ENTRIES_KEY, { type: 'json' })
  if (entries === null || entries === undefined) return SEEDED_ENTRIES
  if (!Array.isArray(entries)) return []

  return entries
    .filter((entry): entry is Entry => Boolean(entry && typeof entry === 'object'))
    .map((entry) => {
      const picks = [entry.pick1, entry.pick2, entry.pick3, entry.pick4]
      const winnerPick =
        typeof (entry as Partial<Entry>).winnerPick === 'string'
          ? (entry as Partial<Entry>).winnerPick ?? null
          : null

      return {
        ...entry,
        winnerPick: winnerPick && picks.includes(winnerPick) ? winnerPick : null,
      }
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

async function saveEntries(entries: Entry[]): Promise<void> {
  await store.setJSON(ENTRIES_KEY, entries)
}

async function getSettings(): Promise<PoolSettings> {
  const settings = await store.get(SETTINGS_KEY, { type: 'json' })
  if (!settings || typeof settings !== 'object') {
    return { ...DEFAULT_SETTINGS }
  }

  return {
    picksOpen:
      typeof settings.picksOpen === 'boolean'
        ? settings.picksOpen
        : DEFAULT_SETTINGS.picksOpen,
    tournamentWinner:
      typeof settings.tournamentWinner === 'string'
        ? settings.tournamentWinner
        : null,
    cutLine:
      typeof settings.cutLine === 'number'
        ? settings.cutLine
        : DEFAULT_SETTINGS.cutLine,
  }
}

async function getManualScores(): Promise<Record<string, ManualScore>> {
  const manualScores = await store.get(SCORES_KEY, { type: 'json' })
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
      wd: Boolean(rawScore.wd),
      wdAfterCut: Boolean(rawScore.wdAfterCut),
    }
  }

  return normalized
}
