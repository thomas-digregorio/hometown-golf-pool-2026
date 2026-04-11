import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  AMATEURS,
  DEFAULT_SETTINGS,
  FIELD,
  TOP5,
  fmtTopar,
  parseHole,
  parseTopar,
  resolveEspnName,
  type Entry,
  type ManualScore,
  type PoolSettings,
} from '@/lib/golf-pool-data'

export const Route = createFileRoute('/')({
  component: GolfPoolPage,
})

type TabName = 'leaderboard' | 'enter' | 'scores' | 'admin'

type LiveScore = {
  topar: number | null
  mc: boolean
  wd: boolean
  wdAfterCut: boolean
  mcR1R2Topar: number | null
  thru: string | null
}

type ApiState = {
  entries: Entry[]
  settings: PoolSettings
  manualScores: Record<string, ManualScore>
}

const WINNER_BONUS = -10
const EXACT_WINNER_BONUS = -5
const TOURNAMENT_START = new Date('2026-04-09T07:00:00-04:00')
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
  const [entryMessage, setEntryMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [entrySubmitting, setEntrySubmitting] = useState(false)

  const [adminUnlocked, setAdminUnlocked] = useState(false)
  const [adminPasswordInput, setAdminPasswordInput] = useState('')
  const [adminPasswordError, setAdminPasswordError] = useState(false)
  const [adminSettingsMessage, setAdminSettingsMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [adminScoresMessage, setAdminScoresMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [adminSavingScores, setAdminSavingScores] = useState(false)
  const [adminScoresDraft, setAdminScoresDraft] = useState<Record<string, ManualScore>>({})

  const canSubmitEntry = useMemo(() => {
    const filledPicks = entryPicks.filter(Boolean)
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
      && filledPicks.includes(entryWinnerPick)
    )
  }, [entryName, entryPicks, entryTiebreaker, entryWinnerPick, settings.picksOpen])

  const pickValidationError = useMemo(() => {
    const filledPicks = entryPicks.filter(Boolean)
    const uniqueCount = new Set(filledPicks).size
    const top5Count = filledPicks.filter((pick) => TOP5.includes(pick as (typeof TOP5)[number])).length

    if (top5Count > 1) return 'You can only pick 1 golfer from the Top 5.'
    if (uniqueCount < filledPicks.length) return 'You picked the same golfer twice.'
    if (filledPicks.length === 4 && !filledPicks.includes(entryWinnerPick)) {
      return 'Select one of your 4 picks as your winning golfer for the exact winner bonus.'
    }
    return null
  }, [entryPicks, entryWinnerPick])

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

  const fetchLiveScores = useCallback(async (manualOverride: Record<string, ManualScore>) => {
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
        const statusDisplay = (competitor.status?.displayValue ?? '').toUpperCase()
        const isWithdrawn =
          statusName === 'STATUS_WITHDRAWN'
          || statusName === 'STATUS_WD'
          || statusDisplay.includes('WITHDRAW')
          || /\bWD\b/.test(statusDisplay)
        const isMissedCut = statusName === 'STATUS_MISSED_CUT' || statusName === 'STATUS_CUT'
        const toPar = parseTopar(competitor.score)
        const roundsPosted = (competitor.linescores ?? []).reduce((count, round) => {
          const hasRoundTopar = parseTopar(round.displayValue) !== null
          const hasHoleData = Array.isArray(round.linescores) && round.linescores.length > 0
          return count + (hasRoundTopar || hasHoleData ? 1 : 0)
        }, 0)

        let mcR1R2Topar: number | null = null
        if ((isMissedCut || isWithdrawn) && (competitor.linescores?.length ?? 0) >= 2) {
          const r1 = parseTopar(competitor.linescores?.[0]?.displayValue)
          const r2 = parseTopar(competitor.linescores?.[1]?.displayValue)
          mcR1R2Topar = r1 !== null && r2 !== null ? r1 + r2 : toPar
        }

        const madeCutAtWithdrawal =
          isWithdrawn
          && ((mcR1R2Topar !== null && mcR1R2Topar <= settings.cutLine) || roundsPosted >= 3)

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
          mc: isMissedCut || (isWithdrawn && !madeCutAtWithdrawal),
          wd: isWithdrawn,
          wdAfterCut: madeCutAtWithdrawal,
          mcR1R2Topar,
          thru,
        }
      }

      setTournamentLive(true)
      setGolferScores(nextScores)
      setLastUpdated(`Updated: ${new Date().toLocaleTimeString()} · ESPN live`)
      return
    } catch {
      const fallbackScores: Record<string, LiveScore> = {}
      for (const golfer of FIELD) {
        const score = manualOverride[golfer]
        if (!score) continue
        fallbackScores[golfer] = {
          topar: score.topar,
          mc: score.mc,
          wd: Boolean(score.wd),
          wdAfterCut: Boolean(score.wdAfterCut),
          mcR1R2Topar: null,
          thru: null,
        }
      }

      setTournamentLive(false)
      setGolferScores(fallbackScores)
      setLastUpdated(`Updated: ${new Date().toLocaleTimeString()} · manual override`)
    }
  }, [settings.cutLine])

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
    const inTournamentWindow = new Date() >= TOURNAMENT_START && new Date() <= TOURNAMENT_END
    const intervalMs = inTournamentWindow ? 3 * 60 * 1000 : 15 * 60 * 1000

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
        mc: Boolean(source?.mc),
        wd: Boolean(source?.wd),
        wdAfterCut: Boolean(source?.wdAfterCut),
      }
    }
    setAdminScoresDraft(draft)
  }, [golferScores])

  const leaderboardData = useMemo(() => {
    const allTopars = Object.values(golferScores)
      .filter((score) => score.topar !== null)
      .map((score) => score.topar as number)
    const madeCutTopars = Object.values(golferScores)
      .filter((score) => !score.mc && score.topar !== null)
      .map((score) => score.topar as number)

    const worstPoolScore = allTopars.length > 0 ? Math.max(...allTopars) : settings.cutLine
    const worstMadeCutScore = madeCutTopars.length > 0 ? Math.max(...madeCutTopars) : settings.cutLine

    const getEffectiveScore = (name: string) => {
      const raw = golferScores[name]
      if (!raw || raw.topar === null || raw.topar === undefined) {
        return { topar: null as number | null, mc: false, wd: false, wdAfterCut: false }
      }

      if (raw.wd && raw.wdAfterCut) {
        return {
          topar: worstMadeCutScore,
          mc: false,
          wd: true,
          wdAfterCut: true,
        }
      }

      if (raw.wd && !raw.wdAfterCut) {
        return {
          topar: worstPoolScore + 1,
          mc: true,
          wd: true,
          wdAfterCut: false,
        }
      }

      if (raw.mc) {
        const firstTwoRounds = raw.mcR1R2Topar !== null ? raw.mcR1R2Topar : raw.topar
        const missedBy = firstTwoRounds !== null ? Math.max(0, firstTwoRounds - settings.cutLine) : 1

        return {
          topar: worstMadeCutScore + missedBy,
          mc: true,
          wd: false,
          wdAfterCut: false,
          missedBy,
        }
      }

      return {
        topar: raw.topar,
        mc: false,
        wd: false,
        wdAfterCut: false,
      }
    }

    const scoredEntries = entries.map((entry) => {
      const picks = [entry.pick1, entry.pick2, entry.pick3, entry.pick4]
      const hasWinnerPick = Boolean(settings.tournamentWinner && picks.includes(settings.tournamentWinner))
      const hasExactWinnerPick = Boolean(
        settings.tournamentWinner && entry.winnerPick && entry.winnerPick === settings.tournamentWinner,
      )

      let total = 0
      let allScored = true

      const details = picks.map((pickName) => {
        const effective = getEffectiveScore(pickName)
        if (effective.topar === null) allScored = false
        total += effective.topar ?? 0

        return {
          name: pickName,
          topar: effective.topar,
          mc: effective.mc,
          wd: effective.wd,
          wdAfterCut: effective.wdAfterCut,
          thru: golferScores[pickName]?.thru ?? null,
          isTop5: TOP5.includes(pickName as (typeof TOP5)[number]),
          isWinner: settings.tournamentWinner === pickName,
        }
      })

      if (allScored && hasWinnerPick) {
        total += WINNER_BONUS
      }
      if (allScored && hasExactWinnerPick) {
        total += EXACT_WINNER_BONUS
      }

      const alternateScores = details
        .filter((detail) => detail.name !== settings.tournamentWinner && detail.topar !== null)
        .map((detail) => detail.topar as number)
      const lowestAlternate = alternateScores.length > 0 ? Math.min(...alternateScores) : null

      return {
        ...entry,
        details,
        allScored,
        total: allScored ? total : null,
        hasWinnerPick,
        hasExactWinnerPick,
        lowestAlternate,
      }
    })

    const ready = scoredEntries.filter((entry) => entry.allScored && entry.total !== null)
    const pending = scoredEntries.filter((entry) => !entry.allScored)

    const winnerScore =
      settings.tournamentWinner && golferScores[settings.tournamentWinner]?.topar !== undefined
        ? golferScores[settings.tournamentWinner]?.topar ?? null
        : null

    ready.sort((a, b) => {
      if (a.total !== b.total) return (a.total as number) - (b.total as number)
      if (winnerScore !== null && winnerScore !== undefined) {
        const aDistance = Math.abs((a.tiebreaker ?? 9999) - winnerScore)
        const bDistance = Math.abs((b.tiebreaker ?? 9999) - winnerScore)
        if (aDistance !== bDistance) return aDistance - bDistance
      }

      const aAlt = a.lowestAlternate ?? 9999
      const bAlt = b.lowestAlternate ?? 9999
      if (aAlt !== bAlt) {
        return aAlt - bAlt
      }
      return 0
    })

    return {
      ready,
      pending,
      lowestTotal: ready.length ? (ready[0].total as number) : null,
      winnerScore,
      topTied: ready.length > 1 && ready[0].total === ready[1].total,
    }
  }, [entries, golferScores, settings.cutLine, settings.tournamentWinner])

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
  }, [canSubmitEntry, entryName, entryPicks, entrySubmitting, entryTiebreaker, entryWinnerPick, loadAll, settings.picksOpen])

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
          ) : null}
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

            {entries.length === 0 ? (
              <div className="empty-state">
                <div className="icon">⛳</div>
                <p>No entries yet. Be the first to submit your picks!</p>
              </div>
            ) : (
              <>
                {!tournamentLive ? (
                  <div className="pretournament-banner">
                    <div className="banner-icon">🏌️</div>
                    <div>
                      <h3>Picks are locked in - we&apos;re ready!</h3>
                      <p>
                        {renderPreTournamentMessage(entries.length)}
                      </p>
                    </div>
                  </div>
                ) : null}

                {settings.tournamentWinner ? (
                  <div className="winner-banner">
                    🏆 <strong>Masters Champion: {settings.tournamentWinner}</strong> - entries with this golfer receive <strong>-10</strong>, plus <strong>-5</strong> more if this was their selected winner pick.
                  </div>
                ) : null}

                {leaderboardData.ready.length > 0 ? (
                  <table className="lb-table">
                    <thead>
                      <tr>
                        <th>Pos</th>
                        <th style={{ textAlign: 'left' }}>Participant &amp; Picks</th>
                        <th>Score</th>
                        <th>Δ Lead</th>
                        <th>Payout</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboardData.ready.map((entry, index) => {
                        const isLeader = index === 0
                        const lowestTotal = leaderboardData.lowestTotal ?? 0
                        const scoreDiff = (entry.total ?? 0) - lowestTotal
                        const payout = isLeader
                          ? leaderboardData.ready
                            .slice(1)
                            .reduce((sum, next) => sum + ((next.total ?? 0) - lowestTotal), 0)
                          : scoreDiff

                        return (
                          <tr key={entry.id} className={isLeader ? 'rank-1' : ''}>
                            <td className="pos-cell">{isLeader ? '🏆' : index + 1}</td>
                            <td>
                              <div className="player-name">{entry.name}</div>
                              <div className="player-picks">
                                {entry.details.map((detail) => {
                                  const holeString = detail.thru ? parseHole(detail.thru) : null
                                  const holePart = holeString && holeString !== 'F' && !detail.mc ? ` / ${holeString}` : ''
                                  const scorePart = detail.topar !== null ? ` (${fmtTopar(detail.topar)}${holePart})` : ''

                                  return (
                                    <span
                                      key={`${entry.id}-${detail.name}`}
                                      className={`pick-chip ${detail.isWinner ? 'winner-pick' : detail.mc || detail.wd ? 'mc' : detail.isTop5 ? 'top5' : ''}`}
                                    >
                                      {detail.name}
                                      {detail.wd
                                        ? detail.wdAfterCut
                                          ? ` WD (R3-4) (${fmtTopar(detail.topar)})`
                                          : ` WD/MC (${fmtTopar(detail.topar)})`
                                        : detail.mc
                                          ? ' MC'
                                          : `${scorePart}${detail.isWinner ? ' 🏆' : ''}`}
                                    </span>
                                  )
                                })}
                              </div>

                              {entry.hasWinnerPick ? (
                                <div className="winner-bonus-note">✅ Winner bonus -10 applied</div>
                              ) : null}
                              {entry.hasExactWinnerPick ? (
                                <div className="winner-bonus-note">✅ Exact winner bonus -5 applied</div>
                              ) : null}

                              {leaderboardData.topTied
                              && entry.total === leaderboardData.lowestTotal
                              && entry.tiebreaker !== null ? (
                                <div className="tiebreaker-note">
                                  🎯 Tiebreaker: {fmtTopar(entry.tiebreaker)}
                                  {leaderboardData.winnerScore !== null
                                    ? ` · actual: ${fmtTopar(leaderboardData.winnerScore)}, off by ${Math.abs(entry.tiebreaker - leaderboardData.winnerScore)}`
                                    : ''}
                                  {entry.lowestAlternate !== null
                                    ? ` · 2nd TB (lowest alternate): ${fmtTopar(entry.lowestAlternate)}`
                                    : ''}
                                </div>
                              ) : null}
                            </td>
                            <td>
                              <span className={`score-big ${toparClass(entry.total)}`}>
                                {fmtTopar(entry.total)}
                              </span>
                            </td>
                            <td className={`diff-cell ${scoreDiff > 0 ? 'diff-over' : ''}`}>
                              {scoreDiff === 0 ? '—' : `+${scoreDiff}`}
                            </td>
                            <td>
                              <span className={isLeader ? 'payout-win' : 'payout-lose'}>
                                {isLeader ? `+$${payout}` : `-$${payout}`}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                ) : null}

                {leaderboardData.pending.length > 0 ? (
                  <>
                    <div className="pending-title">
                      Awaiting live scores ({leaderboardData.pending.length}):
                    </div>
                    {leaderboardData.pending.map((entry) => (
                      <div key={`pending-${entry.id}`} className="pending-card">
                        <strong>{entry.name}</strong>
                        <div className="pending-picks">
                          {entry.details.map((detail) => detail.name).join(' · ')}
                        </div>
                      </div>
                    ))}
                  </>
                ) : null}
              </>
            )}
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
                    <p>The entry window is closed. Check the Leaderboard once the tournament begins.</p>
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
                  <strong>📋 Pool Rules</strong>
                  <ul>
                    <li>Pick 4 golfers - lowest combined to-par score wins</li>
                    <li>Payout: winner collects $1 per stroke from each other entry</li>
                    <li>Only 1 pick allowed from the Top 5 (OWGR)</li>
                    <li>Missed cut penalty: worst made-cut score + strokes missed by</li>
                    <li>
                      WD in rounds 1-2 counts as missed cut and scores worst pool score + 1
                    </li>
                    <li>WD after making cut (rounds 3-4): assigned highest made-cut score</li>
                    <li><strong>🏆 Winner bonus: -10 if champion is in your 4 picks</strong></li>
                    <li><strong>🎯 Exact winner bonus: extra -5 if your chosen winner pick is champion</strong></li>
                    <li>Tiebreaker 1: closest to winner final score (to par)</li>
                    <li>Tiebreaker 2: lowest alternate golfer score</li>
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
                    You may only pick <strong>1 golfer from the Top 5</strong> (Scheffler, McIlroy, Young, Fleetwood, Spaun - OWGR #1-5). The rest must come from the field.
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
                  <label className="form-label" htmlFor="winner-pick">🏆 Winning Golfer Pick (for + bonus)</label>
                  <select
                    id="winner-pick"
                    value={entryWinnerPick}
                    onChange={(event) => setEntryWinnerPick(event.target.value)}
                  >
                    <option value="">- select one of your 4 picks -</option>
                    {entryPicks.filter(Boolean).map((name) => (
                      <option key={`winner-pick-${name}`} value={name}>{name}</option>
                    ))}
                  </select>
                  <div className="form-hint">
                    If this selected golfer wins, your entry receives an additional -5 strokes.
                  </div>
                </div>

                <div className="form-group tiebreaker-group">
                  <label className="form-label" htmlFor="tiebreaker">🎯 Tiebreaker - Winner final score (to par)</label>
                  <input
                    id="tiebreaker"
                    type="number"
                    min={-30}
                    max={10}
                    placeholder="e.g. -17"
                    value={entryTiebreaker}
                    onChange={(event) => setEntryTiebreaker(event.target.value)}
                    className="tiebreaker-input"
                  />
                  <div className="form-hint">
                    Guess the champion&apos;s final score (e.g. -12). This is the first tiebreaker.
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

                <p className="entry-note">You can update your picks any time while the entry window is open.</p>
              </div>
            )}
          </section>
        ) : null}

        {activeTab === 'scores' ? (
          <section>
            <div className="card">
              <h2>📊 Live Golfer Scores</h2>
              <p className="scores-help">
                Scores shown as strokes relative to par (E = even, -3 = 3 under, +2 = 2 over).
                Missed cut and withdrawal penalties are applied automatically.
              </p>

              {!tournamentLive && Object.keys(golferScores).length === 0 ? (
                <div className="empty-state">
                  <div className="icon">📅</div>
                  <p className="empty-title">Tournament starts Thursday, April 9</p>
                  <p className="empty-subtitle">Live scores from ESPN will appear here automatically.</p>
                </div>
              ) : (
                <div className="scores-grid">
                  <div className="sh">Golfer</div>
                  <div className="sh center">Score</div>
                  <div className="sh center">Hole</div>
                  <div className="sh center">Status</div>

                  {[...FIELD]
                    .sort((a, b) => sortScores(a, b, golferScores))
                    .map((name) => {
                      const score = golferScores[name]
                      const toPar = score?.topar ?? null
                      const hole = score?.thru ? parseHole(score.thru) : null
                      const missedCut = Boolean(score?.mc)
                      const withdrew = Boolean(score?.wd)
                      const champion = settings.tournamentWinner === name
                      const isTop5 = TOP5.includes(name as (typeof TOP5)[number])

                      return (
                        <div key={`score-${name}`} className="score-row">
                          <div className={isTop5 || champion ? 'bold-name' : ''}>
                            {name}
                            {champion ? <span className="badge badge-champion mini-badge">🏆</span> : null}
                            {!champion && isTop5 ? <span className="badge badge-gold mini-badge">T5</span> : null}
                            {AMATEURS.has(name) ? <span className="amateur">(a)</span> : null}
                          </div>
                          <div className={`center score-value ${toPar !== null ? toparClass(toPar) : ''}`}>
                            {toPar !== null ? fmtTopar(toPar) : '—'}
                          </div>
                          <div className="center">
                            {missedCut || withdrew ? (
                              <span className="hole-muted">—</span>
                            ) : hole === 'F' ? (
                              <span className="hole-final">F</span>
                            ) : hole ? (
                              <span className="hole-live">{hole}</span>
                            ) : (
                              <span className="hole-muted">—</span>
                            )}
                          </div>
                          <div className="center">
                            {missedCut ? (
                              <span className="badge badge-red">MC</span>
                            ) : withdrew ? (
                              <span className="badge badge-red">WD</span>
                            ) : champion ? (
                              <span className="badge badge-champion">🏆 WON</span>
                            ) : toPar !== null ? (
                              <span className="badge badge-green">Active</span>
                            ) : (
                              <span className="badge badge-gray">—</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                </div>
              )}
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
                      The to-par score a player must meet or beat to make the cut. Default is +6.
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
                    <div className="cut-line-current">Current cut line: {fmtTopar(settings.cutLine)}</div>
                  </div>

                  <div className="settings-block no-border">
                    <div className="toggle-label">🏆 Masters Champion</div>
                    <div className="toggle-sublabel settings-help">
                      Set once the winner is confirmed. Applies -10 if in an entry and -5 more if it matches that entry's winner pick.
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
                    {settings.tournamentWinner ? (
                      <div className="winner-current">
                        ✅ Champion: {settings.tournamentWinner} - -10 for inclusion and -5 for exact winner pick
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="card">
                  <h2>📝 Manual Score Override</h2>
                  <p className="admin-help">
                    ESPN scores are pulled automatically. Use this only to override.
                    Enter to-par integers (-5, 0, +3).
                  </p>

                  {adminScoresMessage ? (
                    <div className={adminScoresMessage.type === 'error' ? 'error-box' : 'success-box'}>
                      {adminScoresMessage.type === 'error' ? '❌' : '✅'} {adminScoresMessage.text}
                    </div>
                  ) : null}

                  {FIELD.map((name) => {
                    const key = safeId(name)
                    const score = adminScoresDraft[name] ?? {
                      topar: null,
                      mc: false,
                      wd: false,
                      wdAfterCut: false,
                    }

                    return (
                      <div key={`admin-score-${key}`} className="admin-grid">
                        <div className="admin-golfer-name">{TOP5.includes(name as (typeof TOP5)[number]) ? '⭐ ' : ''}{name}</div>
                        <input
                          type="number"
                          min={-20}
                          max={40}
                          placeholder="To par"
                          value={score.topar ?? ''}
                          onChange={(event) => {
                            const value = event.target.value
                            setAdminScoresDraft((current) => ({
                              ...current,
                              [name]: {
                                ...current[name],
                                topar: value === '' ? null : Number.parseInt(value, 10),
                                mc: current[name]?.mc ?? false,
                                wd: current[name]?.wd ?? false,
                                wdAfterCut: current[name]?.wdAfterCut ?? false,
                              },
                            }))
                          }}
                        />
                        <label className="mc-label">
                          <input
                            type="checkbox"
                            checked={score.mc}
                            onChange={(event) => {
                              setAdminScoresDraft((current) => ({
                                ...current,
                                [name]: {
                                  ...current[name],
                                  mc: event.target.checked,
                                  topar: current[name]?.topar ?? null,
                                  wd: event.target.checked ? false : (current[name]?.wd ?? false),
                                  wdAfterCut: event.target.checked ? false : (current[name]?.wdAfterCut ?? false),
                                },
                              }))
                            }}
                          />
                          MC
                        </label>
                        <label className="mc-label">
                          <input
                            type="checkbox"
                            checked={score.wd}
                            onChange={(event) => {
                              setAdminScoresDraft((current) => ({
                                ...current,
                                [name]: {
                                  ...current[name],
                                  wd: event.target.checked,
                                  mc: event.target.checked ? false : (current[name]?.mc ?? false),
                                  wdAfterCut: event.target.checked ? (current[name]?.wdAfterCut ?? false) : false,
                                  topar: current[name]?.topar ?? null,
                                },
                              }))
                            }}
                          />
                          WD
                        </label>
                        <label className="mc-label">
                          <input
                            type="checkbox"
                            checked={score.wdAfterCut}
                            disabled={!score.wd}
                            onChange={(event) => {
                              setAdminScoresDraft((current) => ({
                                ...current,
                                [name]: {
                                  ...current[name],
                                  wdAfterCut: event.target.checked,
                                  wd: true,
                                  mc: false,
                                  topar: current[name]?.topar ?? null,
                                },
                              }))
                            }}
                          />
                          WD after cut
                        </label>
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
                          <div className="entry-row-picks">{[entry.pick1, entry.pick2, entry.pick3, entry.pick4].join(' · ')}</div>
                          <div className="entry-row-tb">🏆 Winner pick: {entry.winnerPick ?? '—'}</div>
                          <div className="entry-row-tb">🎯 Tiebreaker: {entry.tiebreaker !== null ? fmtTopar(entry.tiebreaker) : '—'}</div>
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
        © 2026 Bill Engmann &amp; Nevin Wildermuth. All rights reserved.
      </footer>
    </>
  )
}

function safeId(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
}

function renderPreTournamentMessage(entryCount: number): string {
  const daysUntil = Math.ceil((TOURNAMENT_START.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
  if (daysUntil > 0) {
    return `Tournament starts Thursday, April 9 · ${daysUntil} day${daysUntil === 1 ? '' : 's'} away. ${entryCount} ${entryCount === 1 ? 'entry' : 'entries'} submitted.`
  }

  return `Tournament starts today. ${entryCount} ${entryCount === 1 ? 'entry' : 'entries'} submitted.`
}

function toparClass(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'score-even'
  if (value < 0) return 'score-under'
  if (value > 0) return 'score-over'
  return 'score-even'
}

function sortScores(a: string, b: string, scores: Record<string, LiveScore>): number {
  const scoreA = scores[a]
  const scoreB = scores[b]

  const toParA = scoreA?.topar
  const toParB = scoreB?.topar

  if (toParA === null || toParA === undefined) return 1
  if (toParB === null || toParB === undefined) return -1
  if (scoreA?.mc && !scoreB?.mc) return 1
  if (!scoreA?.mc && scoreB?.mc) return -1
  return toParA - toParB
}
