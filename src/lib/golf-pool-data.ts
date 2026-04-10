export type Entry = {
  id: string
  name: string
  pick1: string
  pick2: string
  pick3: string
  pick4: string
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
  mc: boolean
}

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

export const DEFAULT_SETTINGS: PoolSettings = {
  picksOpen: true,
  tournamentWinner: null,
  cutLine: 6,
}
