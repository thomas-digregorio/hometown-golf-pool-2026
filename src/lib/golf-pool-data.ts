export type PlayerStatus = 'active' | 'missed_cut' | 'withdrawn_early' | 'withdrawn_late'

export type Entry = {
  id: string
  name: string
  pick1: string
  pick2: string
  pick3: string
  pick4: string
  winnerPick: string | null
  alternate: string | null
  tiebreaker: number | null
  createdAt: string
}

export type PoolSettings = {
  picksOpen: boolean
  tournamentWinner: string | null
  cutLine: number
}

export type ManualScore = {
  topar: number | null
  status: PlayerStatus
}

type SeedEntryInput = {
  name: string
  tiebreaker: number
  picks: [string, string, string, string]
  winnerPick: string
  alternate: string
}

export const TOURNAMENT_PAR = 72 * 4

export const PLAYER_STATUS_OPTIONS: Array<{ label: string; value: PlayerStatus }> = [
  { label: 'Active', value: 'active' },
  { label: 'Missed cut', value: 'missed_cut' },
  { label: 'WD (rounds 1-2)', value: 'withdrawn_early' },
  { label: 'WD (rounds 3-4)', value: 'withdrawn_late' },
]

export const TOP5 = [
  'Scottie Scheffler',
  'Rory McIlroy',
  'Cameron Young',
  'Tommy Fleetwood',
  'J.J. Spaun',
] as const

export const AMATEURS = new Set([
  'Ethan Fang',
  'Jackson Herrington',
  'Brandon Holtz',
  'Mason Howell',
  'Fifa Laopakdee',
  'Mateo Pulcini',
])

export const FIELD = [
  'Scottie Scheffler',
  'Rory McIlroy',
  'Xander Schauffele',
  'Ludvig Åberg',
  'Collin Morikawa',
  'Akshay Bhatia',
  'Daniel Berger',
  'Keegan Bradley',
  'Michael Brennan',
  'Jacob Bridgeman',
  'Sam Burns',
  'Angel Cabrera',
  'Brian Campbell',
  'Patrick Cantlay',
  'Wyndham Clark',
  'Corey Conners',
  'Fred Couples',
  'Jason Day',
  'Bryson DeChambeau',
  'Nicolas Echavarria',
  'Harris English',
  'Ethan Fang',
  'Matt Fitzpatrick',
  'Tommy Fleetwood',
  'Ryan Fox',
  'Sergio García',
  'Ryan Gerard',
  'Chris Gotterup',
  'Max Greyserman',
  'Ben Griffin',
  'Harry Hall',
  'Brian Harman',
  'Tyrrell Hatton',
  'Russell Henley',
  'Jackson Herrington',
  'Nicolai Højgaard',
  'Rasmus Højgaard',
  'Brandon Holtz',
  'Max Homa',
  'Viktor Hovland',
  'Mason Howell',
  'Sungjae Im',
  'Dustin Johnson',
  'Zach Johnson',
  'Casey Jarvis',
  'John Keefer',
  'Michael Kim',
  'Si Woo Kim',
  'Kurt Kitayama',
  'Jake Knapp',
  'Brooks Koepka',
  'Fifa Laopakdee',
  'Min Woo Lee',
  'Haotong Li',
  'Shane Lowry',
  'Robert MacIntyre',
  'Matt McCarty',
  'Hideki Matsuyama',
  'Tom McKibbin',
  'Maverick McNealy',
  'Rasmus Neergaard-Petersen',
  'Alex Noren',
  'Andrew Novak',
  'Naoyuki Kataoka',
  'José María Olazábal',
  'Carlos Ortiz',
  'Marco Penge',
  'Aldrich Potgieter',
  'Mateo Pulcini',
  'Jon Rahm',
  'Aaron Rai',
  'Patrick Reed',
  'Kristoffer Reitan',
  'Davis Riley',
  'Justin Rose',
  'Adam Scott',
  'Charl Schwartzel',
  'Vijay Singh',
  'Cameron Smith',
  'J.J. Spaun',
  'Jordan Spieth',
  'Samuel Stevens',
  'Sepp Straka',
  'Nick Taylor',
  'Justin Thomas',
  'Sami Välimäki',
  'Bubba Watson',
  'Mike Weir',
  'Danny Willett',
  'Gary Woodland',
  'Cameron Young',
]

export const ESPN_ALIASES: Record<string, string> = {
  'Ludvig Aberg': 'Ludvig Åberg',
  'Ludvig Åberg': 'Ludvig Åberg',
  'Sergio Garcia': 'Sergio García',
  'Sergio García': 'Sergio García',
  'Jose Maria Olazabal': 'José María Olazábal',
  'José María Olazábal': 'José María Olazábal',
  'Sami Valimaki': 'Sami Välimäki',
  'Sami Välimäki': 'Sami Välimäki',
  'Nicolai Hojgaard': 'Nicolai Højgaard',
  'Rasmus Hojgaard': 'Rasmus Højgaard',
  'Im Sungjae': 'Sungjae Im',
  'Kim Si Woo': 'Si Woo Kim',
  'Lee Min Woo': 'Min Woo Lee',
  'J.J. Spaun': 'J.J. Spaun',
  'JJ Spaun': 'J.J. Spaun',
  'Nico Echavarria': 'Nicolas Echavarria',
  'Ángel Cabrera': 'Angel Cabrera',
  'Angel Cabrera': 'Angel Cabrera',
  'Johnny Keefer': 'John Keefer',
}

export function resolveEspnName(name: string | null | undefined): string | null {
  if (!name) return null
  if (ESPN_ALIASES[name]) return ESPN_ALIASES[name]
  if (FIELD.includes(name)) return name
  const lowered = name.toLowerCase()
  return FIELD.find((candidate) => candidate.toLowerCase() === lowered) ?? null
}

export function parseTopar(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '' || value === '—') {
    return null
  }

  const asString = String(value).trim()
  if (asString === 'E' || asString === 'Even') return 0

  const parsed = Number.parseInt(asString, 10)
  return Number.isNaN(parsed) ? null : parsed
}

export function fmtTopar(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value === 0) return 'E'
  return value > 0 ? `+${value}` : `${value}`
}

export function parseHole(thru: string | null | undefined): string | null {
  if (!thru) return null
  const normalized = String(thru).trim()
  if (!normalized || normalized === '—' || normalized === '-') return null

  if (/^[*]?[Ff](inal)?$/.test(normalized)) return 'F'

  const thruMatch = normalized.match(/^[*]?\s*[Tt]hru\s*(\d+)$/)
  if (thruMatch) return `Thru ${thruMatch[1]}`

  const numberMatch = normalized.match(/^[*]?(\d+)$/)
  if (numberMatch) return `H${numberMatch[1]}`

  return normalized
}

export function normalizeTiebreakerGuess(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  return Math.abs(value) > 100 ? value : TOURNAMENT_PAR + value
}

export const DEFAULT_SETTINGS: PoolSettings = {
  picksOpen: false,
  tournamentWinner: null,
  cutLine: 4,
}

export const SEEDED_SETTINGS: PoolSettings = {
  picksOpen: false,
  tournamentWinner: 'Rory McIlroy',
  cutLine: 4,
}

const SEEDED_ENTRY_INPUTS: SeedEntryInput[] = [
  {
    name: 'Digoy',
    tiebreaker: -12,
    picks: ['Jon Rahm', 'Robert MacIntyre', 'Akshay Bhatia', 'Jacob Bridgeman'],
    winnerPick: 'Jon Rahm',
    alternate: 'Rory McIlroy',
  },
  {
    name: 'Elder',
    tiebreaker: -12,
    picks: ['Scottie Scheffler', 'Ludvig Åberg', 'Jordan Spieth', 'Justin Rose'],
    winnerPick: 'Scottie Scheffler',
    alternate: 'Bryson DeChambeau',
  },
  {
    name: 'Nerd*',
    tiebreaker: -13,
    picks: ['Scottie Scheffler', 'Ludvig Åberg', 'Collin Morikawa', 'Haotong Li'],
    winnerPick: 'Scottie Scheffler',
    alternate: 'Xander Schauffele',
  },
  {
    name: 'AT-CAM',
    tiebreaker: -7,
    picks: ['Scottie Scheffler', 'Ludvig Åberg', 'Collin Morikawa', 'J.J. Spaun'],
    winnerPick: 'Scottie Scheffler',
    alternate: 'Tommy Fleetwood',
  },
  {
    name: 'Austin*',
    tiebreaker: -13,
    picks: ['Scottie Scheffler', 'Cameron Young', 'Collin Morikawa', 'Jordan Spieth'],
    winnerPick: 'Scottie Scheffler',
    alternate: 'Matt Fitzpatrick',
  },
  {
    name: 'G-Spot',
    tiebreaker: -13,
    picks: ['Xander Schauffele', 'Matt Fitzpatrick', 'Patrick Reed', 'Corey Conners'],
    winnerPick: 'Xander Schauffele',
    alternate: 'Russell Henley',
  },
  {
    name: 'Smelly',
    tiebreaker: -11,
    picks: ['Jon Rahm', 'Hideki Matsuyama', 'Patrick Reed', 'Corey Conners'],
    winnerPick: 'Jon Rahm',
    alternate: 'Cameron Young',
  },
  {
    name: 'Alejandro',
    tiebreaker: -13,
    picks: ['Scottie Scheffler', 'Tommy Fleetwood', 'Min Woo Lee', 'Collin Morikawa'],
    winnerPick: 'Scottie Scheffler',
    alternate: 'Justin Rose',
  },
  {
    name: 'UM-CAM',
    tiebreaker: -13,
    picks: ['Scottie Scheffler', 'Matt Fitzpatrick', 'Russell Henley', 'Corey Conners'],
    winnerPick: 'Scottie Scheffler',
    alternate: 'Patrick Reed',
  },
  {
    name: 'Cat Linden',
    tiebreaker: -11,
    picks: ['Xander Schauffele', 'Tommy Fleetwood', 'Justin Rose', 'Akshay Bhatia'],
    winnerPick: 'Xander Schauffele',
    alternate: 'Jon Rahm',
  },
  {
    name: 'Sir Atwell',
    tiebreaker: -9,
    picks: ['Matt Fitzpatrick', 'Scottie Scheffler', 'Si Woo Kim', 'Chris Gotterup'],
    winnerPick: 'Matt Fitzpatrick',
    alternate: 'Haotong Li',
  },
]

export const SEEDED_ENTRIES: Entry[] = SEEDED_ENTRY_INPUTS.map((entry, index) => ({
  id: `seed-${String(index + 1).padStart(2, '0')}`,
  name: entry.name,
  pick1: entry.picks[0],
  pick2: entry.picks[1],
  pick3: entry.picks[2],
  pick4: entry.picks[3],
  winnerPick: entry.winnerPick,
  alternate: entry.alternate,
  tiebreaker: entry.tiebreaker,
  createdAt: new Date(Date.UTC(2026, 3, 8, 12, index)).toISOString(),
}))

export const SEEDED_MANUAL_SCORES: Record<string, ManualScore> = {
  'Scottie Scheffler': { topar: -11, status: 'active' },
  'Rory McIlroy': { topar: -22, status: 'active' },
  'Bryson DeChambeau': { topar: 14, status: 'active' },
  'Jon Rahm': { topar: 1, status: 'active' },
  'Xander Schauffele': { topar: -8, status: 'active' },
  'Robert MacIntyre': { topar: 15, status: 'active' },
  'Matt Fitzpatrick': { topar: -4, status: 'active' },
  'Ludvig Åberg': { topar: -3, status: 'active' },
  'Tommy Fleetwood': { topar: 0, status: 'active' },
  'Cameron Young': { topar: -10, status: 'active' },
  'Hideki Matsuyama': { topar: -5, status: 'active' },
  'Patrick Reed': { topar: -5, status: 'active' },
  'Jordan Spieth': { topar: -5, status: 'active' },
  'Corey Conners': { topar: 6, status: 'active' },
  'Russell Henley': { topar: -10, status: 'active' },
  'Akshay Bhatia': { topar: 14, status: 'active' },
  'Min Woo Lee': { topar: 19, status: 'active' },
  'Collin Morikawa': { topar: -9, status: 'active' },
  'J.J. Spaun': { topar: 13, status: 'active' },
  'Si Woo Kim': { topar: 4, status: 'active' },
  'Chris Gotterup': { topar: -2, status: 'active' },
  'Justin Rose': { topar: -10, status: 'active' },
  'Jacob Bridgeman': { topar: 2, status: 'active' },
  'Haotong Li': { topar: 1, status: 'active' },
}
