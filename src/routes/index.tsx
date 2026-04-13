import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  AMATEURS,
  DEFAULT_SETTINGS,
  FIELD,
  PLAYER_STATUS_OPTIONS,
  TOP5,
  TOURNAMENT_PAR,
  fmtTopar,
  normalizeTiebreakerGuess,
  parseHole,
  parseTopar,
  resolveEspnName,
  type Entry,
  type ManualScore,
  type PlayerStatus,
  type PoolSettings,
} from '@/lib/golf-pool-data'

export const Route = createFileRoute('/')({
  component: GolfPoolPage,
})

type TabName = 'leaderboard' | 'enter' | 'scores' | 'admin'

type LiveScore = {
  topar: number | null
  status: PlayerStatus
  firstTwoRoundsTopar: number | null
  thru: string | null
}

type ApiState = {
  entries: Entry[]
  settings: PoolSettings
  manualScores: Record<string, ManualScore>
}

type EffectivePoolScore = {
  name: string
  rawTopar: number | null
  effectiveTopar: number | null
  status: PlayerStatus
  thru: string | null
  note: string | null
}

type EntryScoreDetail = {
  name: string
  rawTopar: number | null
  effectiveTopar: number | null
  status: PlayerStatus
  thru: string | null
  note: string | null
  isTop5: boolean
  isWinnerPick: boolean
  isTournamentWinner: boolean
}

const WINNER_BONUS = -10
const EXACT_WINNER_BONUS = -5
const TOURNAMENT_END = new Date('2026-04-12T20:00:00-04:00')
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD ?? 'CokeZero2026$'

function GolfPoolPage() {
  const [activeTab, setActiveTab] = useState<TabName>('leaderboard')
  const [entries, setEntries] = useState<Entry[]>([])
  const [settings, setSettings] = useState<PoolSettings>(DEFAULT_SETTINGS)
  const [golferScores, setGolferScores] = useState<Record<string, LiveScore>>({})
  const [tournamentLive, setTournamentLive] = useState(false)
  const [lastUpdated, setLastUpdated] = useState('Loading scores...')

  const [entryName, setEntryName] = useState('')
  const [entryTiebreaker, setEntryTiebreaker] = useState('')
  const [entryPicks, setEntryPicks] = useState(['', '', '', ''])
  const [entryWinnerPick, setEntryWinnerPick] = useState('')
  const [entryAlternate, setEntryAlternate] = useState('')
  const [entryMessage, setEntryMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [entrySubmitting, setEntrySubmitting] = useState(false)

  const [adminUnlocked, setAdminUnlocked] = useState(false)
  const [adminPasswordInput, setAdminPasswordInput] = useState('')
  const [adminPasswordError, setAdminPasswordError] = useState(false)
  const [adminSettingsMessage, setAdminSettingsMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [adminScoresMessage, setAdminScoresMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [adminSavingScores, setAdminSavingScores] = useState(false)
  const [adminScoresDraft, setAdminScoresDraft] = useState<Record<string, ManualScore>>({})

  const filledPicks = useMemo(() => entryPicks.filter(Boolean), [entryPicks])
  const winnerPickOptions = useMemo(() => entryPicks.filter(Boolean), [entryPicks])
  const alternateOptions = useMemo(
    () => FIELD.filter((name) => !entryPicks.includes(name)),
    [entryPicks],
  )

  const canSubmitEntry = useMemo(() => {
    const uniqueCount = new Set(filledPicks).size
    const top5Count = filledPicks.filter((pick) => TOP5.includes(pick as (typeof TOP5)[number])).length
    const tbValid = entryTiebreaker.trim() !== '' && !Number.isNaN(Number.parseInt(entryTiebreaker.trim(), 10))

    return (
      settings.picksOpen
      && entryName.trim().length > 0
      && filledPicks.length === 4
      && uniqueCount === filledPicks.length
      && top5Count <= 1
      && tbValid
      && winnerPickOptions.includes(entryWinnerPick)
      && entryAlternate.trim().length > 0
      && alternateOptions.includes(entryAlternate)
    )
  }, [alternateOptions, entryAlternate, entryName, entryTiebreaker, filledPicks, settings.picksOpen, winnerPickOptions, entryWinnerPick])

  const pickValidationError = useMemo(() => {
    const uniqueCount = new Set(filledPicks).size
    const top5Count = filledPicks.filter((pick) => TOP5.includes(pick as (typeof TOP5)[number])).length

    if (top5Count > 1) return 'You can only pick 1 golfer from the Top 5.'
    if (uniqueCount < filledPicks.length) return 'You picked the same golfer twice.'
    if (filledPicks.length === 4 && !winnerPickOptions.includes(entryWinnerPick)) {
      return 'Choose which one of your 4 golfers is your winner pick.'
    }
    if (filledPicks.length === 4 && (entryAlternate.trim() === '' || !alternateOptions.includes(entryAlternate))) {
      return 'Choose a valid alternate who is not one of your 4 picks.'
    }
    return null
  }, [alternateOptions, entryAlternate, entryWinnerPick, filledPicks, winnerPickOptions])

  const loadPoolState = useCallback(async () => {
    const response = await fetch('/api/pool', { cache: 'no-store' })
    if (!response.ok) {
      throw new Error('Failed to load pool state')
    }

    const data = (await response.json()) as ApiState
    setEntries(data.entries)
    setSettings(data.settings)
    return data
  }, [])

  const applyManualScores = useCallback((manualOverride: Record<string, ManualScore>, label: string) => {
    const fallbackScores: Record<string, LiveScore> = {}
    for (const golfer of FIELD) {
      const score = manualOverride[golfer]
      if (!score) continue
      fallbackScores[golfer] = {
        topar: score.topar,
        status: score.status,
        firstTwoRoundsTopar: score.status === 'missed_cut' ? score.topar : null,
        thru: null,
      }
    }

    setTournamentLive(false)
    setGolferScores(fallbackScores)
    setLastUpdated(`Updated: ${new Date().toLocaleTimeString()} · ${label}`)
  }, [])

  const fetchLiveScores = useCallback(async (manualOverride: Record<string, ManualScore>) => {
    if (new Date() > TOURNAMENT_END) {
      applyManualScores(manualOverride, 'final snapshot')
      return
    }

    try {
      const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard', {
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(`ESPN status ${response.status}`)

      const data = (await response.json()) as {
        events?: Array<{
          name?: string
          shortName?: string
          slug?: string
          competitions?: Array<{
            competitors?: Array<{
              athlete?: { displayName?: string }
              status?: { displayValue?: string; type?: { name?: string } }
              score?: string
              linescores?: Array<{ displayValue?: string; linescores?: Array<unknown> }>
            }>
          }>
        }>
      }

      const mastersEvent = (data.events ?? []).find((event) => {
        const haystack = `${event.name ?? ''}${event.shortName ?? ''}${event.slug ?? ''}`.toLowerCase()
        return haystack.includes('masters')
      })

      const competitors = mastersEvent?.competitions?.[0]?.competitors ?? []
      if (competitors.length === 0) {
        throw new Error('No live competitors')
      }

      const nextScores: Record<string, LiveScore> = {}
      for (const competitor of competitors) {
        const resolvedName = resolveEspnName(competitor.athlete?.displayName)
        if (!resolvedName) continue

        const statusName = competitor.status?.type?.name ?? ''
        const status = toPlayerStatus(statusName, competitor.linescores?.length ?? 0)
        const toPar = parseTopar(competitor.score)

        let firstTwoRoundsTopar: number | null = null
        if (status === 'missed_cut' && (competitor.linescores?.length ?? 0) >= 2) {
          const r1 = parseTopar(competitor.linescores?.[0]?.displayValue)
          const r2 = parseTopar(competitor.linescores?.[1]?.displayValue)
          firstTwoRoundsTopar = r1 !== null && r2 !== null ? r1 + r2 : toPar
        }

        let thru = competitor.status?.displayValue ?? null
        if (competitor.linescores?.length) {
          for (let i = competitor.linescores.length - 1; i >= 0; i -= 1) {
            const holes = competitor.linescores[i]?.linescores
            if (holes && holes.length > 0) {
              const holesPlayed = holes.length
              thru = holesPlayed >= 18 ? 'F' : `Thru ${holesPlayed}`
              break
            }
          }
        }

        nextScores[resolvedName] = {
          topar: toPar,
          status,
          firstTwoRoundsTopar,
          thru,
        }
      }

      setTournamentLive((mastersEvent?.competitions?.[0]?.competitors ?? []).some((competitor) => {
        const displayValue = competitor.status?.displayValue?.toLowerCase() ?? ''
        return displayValue.includes('thru') || /^\d+$/.test(displayValue)
      }))
      setGolferScores(nextScores)
      setLastUpdated(`Updated: ${new Date().toLocaleTimeString()} · ESPN live`)
    } catch {
      applyManualScores(manualOverride, 'manual override')
    }
  }, [applyManualScores])

  const loadAll = useCallback(async () => {
    const state = await loadPoolState()
    await fetchLiveScores(state.manualScores)
  }, [fetchLiveScores, loadPoolState])

  useEffect(() => {
    loadAll().catch(() => {
      setLastUpdated('Unable to load data')
    })
  }, [loadAll])

  useEffect(() => {
    const intervalMs = new Date() > TOURNAMENT_END ? 30 * 60 * 1000 : 5 * 60 * 1000

    const interval = setInterval(() => {
      loadAll().catch(() => {
        setLastUpdated('Unable to load data')
      })
    }, intervalMs)

    return () => clearInterval(interval)
  }, [loadAll])

  useEffect(() => {
    const draft: Record<string, ManualScore> = {}
    for (const golfer of FIELD) {
      const source = golferScores[golfer]
      draft[golfer] = {
        topar: source?.topar ?? null,
        status: source?.status ?? 'active',
      }
    }
    setAdminScoresDraft(draft)
  }, [golferScores])

  const poolGolfers = useMemo(() => {
    const names = new Set<string>()
    for (const entry of entries) {
      for (const pick of [entry.pick1, entry.pick2, entry.pick3, entry.pick4]) {
        if (pick) names.add(pick)
      }
      if (entry.alternate) names.add(entry.alternate)
    }
    if (settings.tournamentWinner) names.add(settings.tournamentWinner)

    if (names.size === 0) {
      return Object.keys(golferScores).length > 0 ? Object.keys(golferScores) : FIELD
    }

    return [...names]
  }, [entries, golferScores, settings.tournamentWinner])

  const effectivePoolScores = useMemo(() => {
    const referenceMadeCutScores = poolGolfers
      .map((name) => golferScores[name])
      .filter((score): score is LiveScore => Boolean(score && score.topar !== null && score.status === 'active'))
      .map((score) => score.topar as number)

    const worstMadeCutScore = referenceMadeCutScores.length > 0
      ? Math.max(...referenceMadeCutScores)
      : settings.cutLine

    const scoreMap: Record<string, EffectivePoolScore> = {}
    const earlyWithdrawals: string[] = []

    for (const name of poolGolfers) {
      const raw = golferScores[name]
      if (!raw || raw.topar === null || raw.topar === undefined) {
        scoreMap[name] = {
          name,
          rawTopar: null,
          effectiveTopar: null,
          status: raw?.status ?? 'active',
          thru: raw?.thru ?? null,
          note: null,
        }
        continue
      }

      if (raw.status === 'missed_cut') {
        const firstTwoRounds = raw.firstTwoRoundsTopar ?? raw.topar
        const missedBy = firstTwoRounds !== null ? Math.max(0, firstTwoRounds - settings.cutLine) : 1
        scoreMap[name] = {
          name,
          rawTopar: raw.topar,
          effectiveTopar: worstMadeCutScore + missedBy,
          status: raw.status,
          thru: raw.thru,
          note: `MC penalty: ${fmtTopar(worstMadeCutScore)} + ${missedBy}`,
        }
        continue
      }

      if (raw.status === 'withdrawn_late') {
        scoreMap[name] = {
          name,
          rawTopar: raw.topar,
          effectiveTopar: worstMadeCutScore,
          status: raw.status,
          thru: raw.thru,
          note: `WD R3/R4 penalty: ${fmtTopar(worstMadeCutScore)}`,
        }
        continue
      }

      if (raw.status === 'withdrawn_early') {
        earlyWithdrawals.push(name)
        scoreMap[name] = {
          name,
          rawTopar: raw.topar,
          effectiveTopar: null,
          status: raw.status,
          thru: raw.thru,
          note: null,
        }
        continue
      }

      scoreMap[name] = {
        name,
        rawTopar: raw.topar,
        effectiveTopar: raw.topar,
        status: raw.status,
        thru: raw.thru,
        note: null,
      }
    }

    const currentWorstPoolScore = Object.values(scoreMap)
      .filter((score) => score.effectiveTopar !== null)
      .map((score) => score.effectiveTopar as number)

    const worstPoolScore = currentWorstPoolScore.length > 0
      ? Math.max(...currentWorstPoolScore)
      : worstMadeCutScore

    for (const name of earlyWithdrawals) {
      scoreMap[name] = {
        ...(scoreMap[name] ?? {
          name,
          rawTopar: null,
          effectiveTopar: null,
          status: 'withdrawn_early' as PlayerStatus,
          thru: null,
          note: null,
        }),
        effectiveTopar: worstPoolScore + 1,
        note: `WD R1/R2 penalty: ${fmtTopar(worstPoolScore + 1)}`,
      }
    }

    return scoreMap
  }, [golferScores, poolGolfers, settings.cutLine])

  const leaderboardData = useMemo(() => {
    const winnerToPar = settings.tournamentWinner ? golferScores[settings.tournamentWinner]?.topar ?? null : null
    const winnerRawScore = winnerToPar === null ? null : TOURNAMENT_PAR + winnerToPar

    const scoredEntries = entries.map((entry) => {
      const picks = [entry.pick1, entry.pick2, entry.pick3, entry.pick4]
      let subtotal = 0
      let allScored = true

      const details = picks.map((pickName) => {
        const effective = effectivePoolScores[pickName]
        if (!effective || effective.effectiveTopar === null) {
          allScored = false
        }
        subtotal += effective?.effectiveTopar ?? 0

        return {
          name: pickName,
          rawTopar: effective?.rawTopar ?? null,
          effectiveTopar: effective?.effectiveTopar ?? null,
          status: effective?.status ?? 'active',
          thru: effective?.thru ?? null,
          note: effective?.note ?? null,
          isTop5: TOP5.includes(pickName as (typeof TOP5)[number]),
          isWinnerPick: entry.winnerPick === pickName,
          isTournamentWinner: settings.tournamentWinner === pickName,
        } satisfies EntryScoreDetail
      })

      const hasWinnerPick = Boolean(settings.tournamentWinner && picks.includes(settings.tournamentWinner))
      const exactWinnerHit = Boolean(
        settings.tournamentWinner
        && entry.winnerPick
        && entry.winnerPick === settings.tournamentWinner,
      )
      const total = allScored
        ? subtotal + (hasWinnerPick ? WINNER_BONUS : 0) + (exactWinnerHit ? EXACT_WINNER_BONUS : 0)
        : null

      const alternateScore = entry.alternate ? effectivePoolScores[entry.alternate]?.effectiveTopar ?? null : null
      const normalizedGuess = normalizeTiebreakerGuess(entry.tiebreaker)
      const tiebreakDistance =
        normalizedGuess !== null && winnerRawScore !== null ? Math.abs(normalizedGuess - winnerRawScore) : null

      return {
        ...entry,
        details,
        allScored,
        subtotal: allScored ? subtotal : null,
        total,
        hasWinnerPick,
        exactWinnerHit,
        alternateScore,
        normalizedGuess,
        tiebreakDistance,
      }
    })

    const sorted = [...scoredEntries].sort((a, b) => compareEntries(a, b))
    const lowestTotal = sorted.find((entry) => entry.total !== null)?.total ?? null

    const withPayouts = sorted.map((entry, index) => {
      const difference = entry.total !== null && lowestTotal !== null ? entry.total - lowestTotal : null
      const payout = difference === null ? null : index === 0
        ? sorted
          .slice(1)
          .reduce((sum, next) => sum + Math.max(0, (next.total ?? lowestTotal) - lowestTotal), 0)
        : difference

      return {
        ...entry,
        rank: entry.total === null ? null : index + 1,
        difference,
        payout,
      }
    })

    const tiebreakRows = [...withPayouts].sort((a, b) => compareTiebreakRows(a, b))

    return {
      rows: withPayouts,
      tiebreakRows,
      lowestTotal,
      winnerToPar,
      winnerRawScore,
    }
  }, [effectivePoolScores, entries, golferScores, settings.tournamentWinner])

  const scoreTableRows = useMemo(() => {
    return FIELD
      .map((name) => {
        const raw = golferScores[name]
        const applied = effectivePoolScores[name]

        return {
          name,
          topar: raw?.topar ?? null,
          status: raw?.status ?? 'active',
          thru: raw?.thru ?? null,
          note: applied?.note ?? null,
        }
      })
      .filter((row) => row.topar !== null || row.status !== 'active')
      .sort((a, b) => sortScoreTableRows(a, b))
  }, [effectivePoolScores, golferScores])

  const submitEntry = useCallback(async () => {
    if (!canSubmitEntry || !settings.picksOpen || entrySubmitting) return

    setEntrySubmitting(true)
    setEntryMessage(null)

    try {
      const response = await fetch('/api/pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert-entry',
          entry: {
            name: entryName.trim(),
            pick1: entryPicks[0],
            pick2: entryPicks[1],
            pick3: entryPicks[2],
            pick4: entryPicks[3],
            winnerPick: entryWinnerPick,
            alternate: entryAlternate,
            tiebreaker: Number.parseInt(entryTiebreaker.trim(), 10),
          },
        }),
      })

      if (!response.ok) {
        throw new Error('Unable to save entry')
      }

      setEntryMessage({
        type: 'success',
        text: `Picks submitted for ${entryName.trim()}.`,
      })

      await loadAll()
    } catch {
      setEntryMessage({
        type: 'error',
        text: 'Unable to submit picks right now.',
      })
    } finally {
      setEntrySubmitting(false)
    }
  }, [canSubmitEntry, entryAlternate, entryName, entryPicks, entrySubmitting, entryTiebreaker, entryWinnerPick, loadAll, settings.picksOpen])

  const saveSettings = useCallback(async (updates: Partial<PoolSettings>) => {
    setAdminSettingsMessage(null)

    const response = await fetch('/api/pool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save-settings',
        settings: updates,
      }),
    })

    if (!response.ok) {
      throw new Error('Unable to save settings')
    }

    await loadAll()
  }, [loadAll])

  const saveManualScores = useCallback(async () => {
    setAdminSavingScores(true)
    setAdminScoresMessage(null)

    try {
      const response = await fetch('/api/pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save-manual-scores',
          scores: adminScoresDraft,
        }),
      })

      if (!response.ok) {
        throw new Error('Unable to save scores')
      }

      await loadAll()
      setAdminScoresMessage({ type: 'success', text: 'Scores saved.' })
    } catch {
      setAdminScoresMessage({ type: 'error', text: 'Unable to save scores.' })
    } finally {
      setAdminSavingScores(false)
    }
  }, [adminScoresDraft, loadAll])

  const deleteEntry = useCallback(async (id: string) => {
    const response = await fetch('/api/pool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'delete-entry',
        id,
      }),
    })

    if (response.ok) {
      await loadAll()
    }
  }, [loadAll])

  const unlockAdmin = () => {
    if (adminPasswordInput === ADMIN_PASSWORD) {
      setAdminUnlocked(true)
      setAdminPasswordError(false)
      setAdminPasswordInput('')
      return
    }

    setAdminPasswordError(true)
    setAdminPasswordInput('')
  }

  const lockAdmin = () => {
    setAdminUnlocked(false)
    setAdminPasswordInput('')
    setAdminPasswordError(false)
  }

  return (
    <>
      <header>
        <div className="header-inner">
          <div className="header-title">
            <span className="flag">⛳</span>
            <div>
              <h1>Golf Pool 2026</h1>
              <div className="subtitle">Masters · Augusta National · Apr 9-12</div>
            </div>
          </div>
          {tournamentLive ? (
            <div className="live-badge">
              <div className="live-dot" />
              LIVE
            </div>
          ) : (
            <div className="live-badge is-final">FINAL</div>
          )}
        </div>
      </header>

      <main className="main">
        <div className="tabs">
          <button
            type="button"
            className={`tab ${activeTab === 'leaderboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('leaderboard')}
          >
            🏆 Leaderboard
          </button>
          <button
            type="button"
            className={`tab ${activeTab === 'enter' ? 'active' : ''}`}
            onClick={() => setActiveTab('enter')}
          >
            ✏️ Enter Picks
          </button>
          <button
            type="button"
            className={`tab ${activeTab === 'scores' ? 'active' : ''}`}
            onClick={() => setActiveTab('scores')}
          >
            📊 Scores
          </button>
          <button
            type="button"
            className={`tab ${activeTab === 'admin' ? 'active' : ''}`}
            onClick={() => setActiveTab('admin')}
          >
            ⚙️ Admin
          </button>
        </div>

        {activeTab === 'leaderboard' ? (
          <section>
            <div className="refresh-bar">
              <span>{lastUpdated}</span>
              <button
                type="button"
                className="btn btn-outline refresh-btn"
                onClick={() => {
                  loadAll().catch(() => {
                    setLastUpdated('Unable to load data')
                  })
                }}
              >
                ↻ Refresh
              </button>
            </div>
            <div className="card leaderboard-card">
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th>Pos</th>
                    <th>Participant &amp; Picks</th>
                    <th>Score</th>
                    <th>Δ Lead</th>
                    <th>Payout</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboardData.rows.map((entry, index) => {
                    const adjustmentNotes = [
                      ...entry.details
                        .filter((detail) => detail.note)
                        .map((detail) => `${detail.name}: ${detail.note}`),
                      entry.hasWinnerPick ? 'Winner bonus -10 applied' : null,
                      entry.exactWinnerHit ? 'Exact winner bonus -5 applied' : null,
                    ].filter((note): note is string => Boolean(note))

                    return (
                      <tr key={entry.id} className={index === 0 ? 'leaderboard-row leader' : 'leaderboard-row'}>
                        <td className="leaderboard-pos">{index === 0 ? '🏆' : entry.rank ?? '—'}</td>
                        <td className="leaderboard-entry">
                          <div className="leaderboard-name">{entry.name}</div>
                          <div className="leaderboard-picks">
                            {entry.details.map((detail) => (
                              <span
                                key={`${entry.id}-${detail.name}`}
                                className={pickChipClassName(detail)}
                              >
                                {detail.name} ({fmtTopar(detail.effectiveTopar)})
                              </span>
                            ))}
                          </div>
                          {adjustmentNotes.length > 0 ? (
                            <div className="leaderboard-adjustments">
                              {adjustmentNotes.map((note) => (
                                <span key={`${entry.id}-${note}`} className="leaderboard-adjustment-chip">
                                  {note}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <div className="leaderboard-meta">
                            <span>Winner pick: {entry.winnerPick ?? '—'}</span>
                            <span>Alternate: {entry.alternate ?? '—'}{entry.alternateScore !== null ? ` (${fmtTopar(entry.alternateScore)})` : ''}</span>
                            <span>Tiebreaker: {formatSubmittedTiebreaker(entry.tiebreaker)}</span>
                          </div>
                        </td>
                        <td className={`leaderboard-score ${toparClass(entry.total)}`}>{fmtTopar(entry.total)}</td>
                        <td className={entry.difference !== null && entry.difference > 0 ? 'leaderboard-diff over' : 'leaderboard-diff'}>
                          {entry.difference === null || entry.difference === 0 ? '—' : `+${entry.difference}`}
                        </td>
                        <td className={index === 0 ? 'leaderboard-payout payout-win' : 'leaderboard-payout payout-lose'}>
                          {entry.payout === null ? '—' : index === 0 ? `+$${entry.payout}` : `-$${entry.payout}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {activeTab === 'enter' ? (
          <section>
            {!settings.picksOpen ? (
              <div className="card">
                <div className="locked-banner">
                  <div className="banner-icon">🔒</div>
                  <div>
                    <h3>Picks are locked</h3>
                    <p>The tournament is underway or complete. Use Admin if you need to reopen entries.</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="card">
                <h2>✏️ Submit Your Picks</h2>

                {entryMessage ? (
                  <div className={entryMessage.type === 'error' ? 'error-box' : 'success-box'}>
                    {entryMessage.type === 'error' ? '❌' : '✅'} {entryMessage.text}
                  </div>
                ) : null}

                <div className="rules-notice">
                  <strong>Pool rules</strong>
                  <ul>
                    <li>Pick 4 golfers. Lowest cumulative score wins.</li>
                    <li>You can only use 1 golfer from the Top 5 in your 4 picks.</li>
                    <li>If the winner is in your 4, you get -10. If your designated winner pick is exact, you get another -5.</li>
                    <li>Tiebreaker is the winning golfer&apos;s final score. The second tiebreaker is the lowest alternate.</li>
                  </ul>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="entry-name">Your name</label>
                  <input
                    id="entry-name"
                    type="text"
                    value={entryName}
                    placeholder="e.g. John Smith"
                    maxLength={40}
                    onChange={(event) => setEntryName(event.target.value)}
                  />
                </div>

                <div className="top5-notice">
                  ⭐
                  <span>
                    One Top 5 golfer max in your main four. The alternate can be any golfer not already in your picks.
                  </span>
                </div>

                {entryPicks.map((pick, index) => (
                  <div key={`pick-${index}`} className="form-group">
                    <label className="form-label" htmlFor={`pick-${index}`}>{`Pick ${index + 1}`}</label>
                    <div className="pick-row">
                      <div className="pick-num">{index + 1}</div>
                      <select
                        id={`pick-${index}`}
                        value={pick}
                        onChange={(event) => {
                          const next = [...entryPicks]
                          next[index] = event.target.value
                          setEntryPicks(next)

                          if (!next.includes(entryWinnerPick)) {
                            setEntryWinnerPick('')
                          }
                          if (next.includes(entryAlternate)) {
                            setEntryAlternate('')
                          }
                        }}
                      >
                        <option value="">- select golfer -</option>
                        <optgroup label="⭐ Top 5 (pick at most 1)">
                          {TOP5.map((name) => (
                            <option key={`top5-${name}`} value={name}>{name}</option>
                          ))}
                        </optgroup>
                        <optgroup label="Field">
                          {FIELD.filter((name) => !TOP5.includes(name as (typeof TOP5)[number])).map((name) => (
                            <option key={`field-${name}`} value={name}>
                              {name}
                              {AMATEURS.has(name) ? ' (a)' : ''}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </div>
                  </div>
                ))}

                <div className="form-group">
                  <label className="form-label" htmlFor="winner-pick">Designated winner pick</label>
                  <select
                    id="winner-pick"
                    value={entryWinnerPick}
                    onChange={(event) => setEntryWinnerPick(event.target.value)}
                  >
                    <option value="">- choose one of your 4 picks -</option>
                    {winnerPickOptions.map((name) => (
                      <option key={`winner-pick-${name}`} value={name}>{name}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="alternate-pick">Alternate</label>
                  <select
                    id="alternate-pick"
                    value={entryAlternate}
                    onChange={(event) => setEntryAlternate(event.target.value)}
                  >
                    <option value="">- choose alternate -</option>
                    {alternateOptions.map((name) => (
                      <option key={`alternate-${name}`} value={name}>
                        {name}
                        {AMATEURS.has(name) ? ' (a)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group tiebreaker-group">
                  <label className="form-label" htmlFor="tiebreaker">Tiebreaker - winning golfer final score</label>
                  <input
                    id="tiebreaker"
                    type="number"
                    min={-30}
                    max={300}
                    placeholder="e.g. -12 or 276"
                    value={entryTiebreaker}
                    onChange={(event) => setEntryTiebreaker(event.target.value)}
                    className="tiebreaker-input"
                  />
                  <div className="form-hint">
                    Enter either the winner&apos;s score to par or total strokes.
                  </div>
                </div>

                {pickValidationError ? (
                  <div className="error-box">⚠️ {pickValidationError}</div>
                ) : null}

                <button
                  type="button"
                  className="btn btn-primary full-width"
                  disabled={!canSubmitEntry || entrySubmitting}
                  onClick={() => {
                    submitEntry().catch(() => {
                      setEntryMessage({ type: 'error', text: 'Unable to submit picks right now.' })
                    })
                  }}
                >
                  {entrySubmitting ? 'Submitting...' : 'Submit My Picks'}
                </button>

                <p className="entry-note">You can update your entry while the entry window is open.</p>
              </div>
            )}
          </section>
        ) : null}

        {activeTab === 'scores' ? (
          <section>
            <div className="card scores-card">
              <h2>📊 Live Golfer Scores</h2>
              <p className="scores-help">
                Scores shown as strokes relative to par (E = even, -3 = 3 under, +2 = 2 over).
                Missed cut and withdrawal statuses update automatically.
              </p>

              <div className="scores-table">
                <div className="scores-table-head">Golfer</div>
                <div className="scores-table-head center">Score</div>
                <div className="scores-table-head center">Hole</div>
                <div className="scores-table-head center">Status</div>

                {scoreTableRows.map((score) => {
                  const hole = score.thru ? parseHole(score.thru) : null
                  return (
                    <div key={`score-${score.name}`} className="scores-table-row">
                      <div className="scores-table-cell golfer">
                        <span className={TOP5.includes(score.name as (typeof TOP5)[number]) ? 'bold-name' : ''}>
                          {score.name}
                        </span>
                        {TOP5.includes(score.name as (typeof TOP5)[number]) ? <span className="badge badge-gold mini-badge">T5</span> : null}
                      </div>
                      <div className={`scores-table-cell center ${toparClass(score.topar)}`}>{fmtTopar(score.topar)}</div>
                      <div className="scores-table-cell center">
                        {score.status !== 'active' ? '—' : hole === 'F' ? 'F' : hole ?? '—'}
                      </div>
                      <div className="scores-table-cell center">
                        <span className={`badge ${statusBadgeClass(score.status)}`}>{statusLabel(score.status)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === 'admin' ? (
          <section>
            {!adminUnlocked ? (
              <div className="card">
                <h2>⚙️ Admin Access</h2>
                <p className="admin-help">Enter the admin password to continue.</p>
                <div className="admin-pass-row">
                  <input
                    type="password"
                    placeholder="Password"
                    value={adminPasswordInput}
                    onChange={(event) => setAdminPasswordInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') unlockAdmin()
                    }}
                  />
                  <button type="button" className="btn btn-primary" onClick={unlockAdmin}>Unlock</button>
                </div>
                {adminPasswordError ? (
                  <div className="admin-pass-error">❌ Incorrect password.</div>
                ) : null}
              </div>
            ) : (
              <>
                <div className="card">
                  <h2>⚙️ Pool Settings</h2>

                  {adminSettingsMessage ? (
                    <div className={adminSettingsMessage.type === 'error' ? 'error-box' : 'success-box'}>
                      {adminSettingsMessage.type === 'error' ? '❌' : '✅'} {adminSettingsMessage.text}
                    </div>
                  ) : null}

                  <div className="toggle-row">
                    <div>
                      <div className="toggle-label">Entry Window</div>
                      <div className="toggle-sublabel">
                        {settings.picksOpen
                          ? 'Open - participants can submit or update picks'
                          : 'Locked - pick submission is disabled'}
                      </div>
                    </div>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={settings.picksOpen}
                        onChange={async (event) => {
                          try {
                            await saveSettings({ picksOpen: event.target.checked })
                            setAdminSettingsMessage({
                              type: 'success',
                              text: `Entry window ${event.target.checked ? 'opened' : 'locked'}.`,
                            })
                          } catch {
                            setAdminSettingsMessage({ type: 'error', text: 'Unable to update entry window.' })
                          }
                        }}
                      />
                      <span className="toggle-slider" />
                    </label>
                  </div>

                  <div className="settings-block">
                    <div className="toggle-label">✂️ Cut Line (to par)</div>
                    <div className="toggle-sublabel settings-help">
                      Players missing the cut get the worst made-cut score plus the number of shots they missed by.
                    </div>
                    <div className="settings-row">
                      <input
                        type="number"
                        min={-10}
                        max={20}
                        value={settings.cutLine}
                        onChange={(event) => {
                          const nextCutLine = Number.parseInt(event.target.value, 10)
                          if (!Number.isNaN(nextCutLine)) {
                            setSettings((current) => ({ ...current, cutLine: nextCutLine }))
                          }
                        }}
                        className="cut-line-input"
                      />
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={async () => {
                          try {
                            await saveSettings({ cutLine: settings.cutLine })
                            setAdminSettingsMessage({
                              type: 'success',
                              text: `Cut line set to ${fmtTopar(settings.cutLine)}.`,
                            })
                          } catch {
                            setAdminSettingsMessage({ type: 'error', text: 'Unable to save cut line.' })
                          }
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </div>

                  <div className="settings-block no-border">
                    <div className="toggle-label">🏆 Tournament Winner</div>
                    <div className="toggle-sublabel settings-help">
                      Used for the -10 winner bonus and the extra -5 exact winner bonus.
                    </div>
                    <div className="settings-row">
                      <select
                        value={settings.tournamentWinner ?? ''}
                        onChange={(event) => {
                          const next = event.target.value.trim()
                          setSettings((current) => ({
                            ...current,
                            tournamentWinner: next.length > 0 ? next : null,
                          }))
                        }}
                      >
                        <option value="">- No winner set yet -</option>
                        {[...FIELD].sort((a, b) => a.localeCompare(b)).map((name) => (
                          <option key={`winner-${name}`} value={name}>{name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn-gold"
                        onClick={async () => {
                          try {
                            await saveSettings({ tournamentWinner: settings.tournamentWinner })
                            setAdminSettingsMessage({
                              type: 'success',
                              text: settings.tournamentWinner
                                ? `Winner set to ${settings.tournamentWinner}.`
                                : 'Winner cleared.',
                            })
                          } catch {
                            setAdminSettingsMessage({ type: 'error', text: 'Unable to save winner.' })
                          }
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                </div>

                <div className="card">
                  <h2>📝 Manual Score Override</h2>
                  <p className="admin-help">
                    Set the official to-par score and status for any golfer you want to override.
                  </p>

                  {adminScoresMessage ? (
                    <div className={adminScoresMessage.type === 'error' ? 'error-box' : 'success-box'}>
                      {adminScoresMessage.type === 'error' ? '❌' : '✅'} {adminScoresMessage.text}
                    </div>
                  ) : null}

                  {poolGolfers.map((name) => {
                    const score = adminScoresDraft[name] ?? { topar: null, status: 'active' as PlayerStatus }

                    return (
                      <div key={`admin-score-${safeId(name)}`} className="admin-grid">
                        <div className="admin-golfer-name">{name}</div>
                        <input
                          type="number"
                          min={-40}
                          max={60}
                          placeholder="To par"
                          value={score.topar ?? ''}
                          onChange={(event) => {
                            const value = event.target.value
                            setAdminScoresDraft((current) => ({
                              ...current,
                              [name]: {
                                ...current[name],
                                topar: value === '' ? null : Number.parseInt(value, 10),
                                status: current[name]?.status ?? 'active',
                              },
                            }))
                          }}
                        />
                        <select
                          value={score.status}
                          onChange={(event) => {
                            setAdminScoresDraft((current) => ({
                              ...current,
                              [name]: {
                                ...current[name],
                                topar: current[name]?.topar ?? null,
                                status: event.target.value as PlayerStatus,
                              },
                            }))
                          }}
                        >
                          {PLAYER_STATUS_OPTIONS.map((option) => (
                            <option key={`${name}-${option.value}`} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                    )
                  })}

                  <button
                    type="button"
                    className="btn btn-primary full-width mt16"
                    onClick={() => {
                      saveManualScores().catch(() => {
                        setAdminScoresMessage({ type: 'error', text: 'Unable to save scores.' })
                      })
                    }}
                    disabled={adminSavingScores}
                  >
                    {adminSavingScores ? 'Saving...' : '💾 Save All Scores'}
                  </button>
                </div>

                <div className="card">
                  <h2>🗑️ Manage Entries</h2>
                  {entries.length === 0 ? (
                    <p className="empty-subtitle">No entries yet.</p>
                  ) : (
                    entries.map((entry) => (
                      <div key={`entry-admin-${entry.id}`} className="entry-row">
                        <div>
                          <div className="entry-row-name">{entry.name}</div>
                          <div className="entry-row-picks">
                            {[entry.pick1, entry.pick2, entry.pick3, entry.pick4].join(' · ')}
                          </div>
                          <div className="entry-row-tb">
                            Winner: {entry.winnerPick ?? '—'} · Alternate: {entry.alternate ?? '—'} · Tiebreaker: {formatSubmittedTiebreaker(entry.tiebreaker)}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="delete-btn"
                          onClick={() => {
                            deleteEntry(entry.id).catch(() => undefined)
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <button type="button" className="btn btn-outline full-width" onClick={lockAdmin}>🔒 Lock Admin</button>
              </>
            )}
          </section>
        ) : null}
      </main>

      <footer className="site-footer">
        © 2026 Bill Engmann &amp; Nevin Wildermuth. Final standings update.
      </footer>
    </>
  )
}

function compareEntries(
  a: {
    total: number | null
    tiebreakDistance: number | null
    alternateScore: number | null
    name: string
  },
  b: {
    total: number | null
    tiebreakDistance: number | null
    alternateScore: number | null
    name: string
  },
): number {
  if (a.total === null && b.total === null) return a.name.localeCompare(b.name)
  if (a.total === null) return 1
  if (b.total === null) return -1
  if (a.total !== b.total) return a.total - b.total

  const tiebreak = compareNullableNumbers(a.tiebreakDistance, b.tiebreakDistance)
  if (tiebreak !== 0) return tiebreak

  const alternate = compareNullableNumbers(a.alternateScore, b.alternateScore)
  if (alternate !== 0) return alternate

  return a.name.localeCompare(b.name)
}

function compareTiebreakRows(
  a: {
    rank: number | null
    tiebreakDistance: number | null
    alternateScore: number | null
    name: string
  },
  b: {
    rank: number | null
    tiebreakDistance: number | null
    alternateScore: number | null
    name: string
  },
): number {
  const rankCompare = compareNullableNumbers(a.rank, b.rank)
  if (rankCompare !== 0) return rankCompare

  const distanceCompare = compareNullableNumbers(a.tiebreakDistance, b.tiebreakDistance)
  if (distanceCompare !== 0) return distanceCompare

  const alternateCompare = compareNullableNumbers(a.alternateScore, b.alternateScore)
  if (alternateCompare !== 0) return alternateCompare

  return a.name.localeCompare(b.name)
}

function compareNullableNumbers(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a - b
}

function sortScoreTableRows(
  a: { name: string; topar: number | null; status: PlayerStatus },
  b: { name: string; topar: number | null; status: PlayerStatus },
): number {
  if (a.status === 'active' && b.status !== 'active') return -1
  if (a.status !== 'active' && b.status === 'active') return 1

  const scoreCompare = compareNullableNumbers(a.topar, b.topar)
  if (scoreCompare !== 0) return scoreCompare
  return a.name.localeCompare(b.name)
}

function toPlayerStatus(statusName: string, roundsTracked: number): PlayerStatus {
  if (statusName === 'STATUS_MISSED_CUT' || statusName === 'STATUS_CUT') {
    return 'missed_cut'
  }

  if (statusName.toUpperCase().includes('WITHDRAW')) {
    return roundsTracked >= 3 ? 'withdrawn_late' : 'withdrawn_early'
  }

  return 'active'
}

function statusLabel(status: PlayerStatus): string {
  switch (status) {
    case 'missed_cut':
      return 'MC'
    case 'withdrawn_early':
      return 'WD R1/R2'
    case 'withdrawn_late':
      return 'WD R3/R4'
    default:
      return 'Active'
  }
}

function statusBadgeClass(status: PlayerStatus): string {
  switch (status) {
    case 'missed_cut':
      return 'badge-red'
    case 'withdrawn_early':
    case 'withdrawn_late':
      return 'badge-amber'
    default:
      return 'badge-green'
  }
}

function formatSubmittedTiebreaker(value: number | null): string {
  if (value === null || value === undefined) return '—'
  return Math.abs(value) > 100 ? `${value}` : fmtTopar(value)
}

function pickChipClassName(detail: EntryScoreDetail): string {
  if (detail.status !== 'active') return 'leaderboard-pick-chip penalty'
  if (detail.isWinnerPick || detail.isTournamentWinner) return 'leaderboard-pick-chip winner'
  if (detail.isTop5) return 'leaderboard-pick-chip top5'
  return 'leaderboard-pick-chip'
}

function safeId(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
}

function toparClass(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'score-even'
  if (value < 0) return 'score-under'
  if (value > 0) return 'score-over'
  return 'score-even'
}
