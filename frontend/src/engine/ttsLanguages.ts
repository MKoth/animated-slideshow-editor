export const TTS_ALLOWED_ISOS = [
  'zh',
  'en',
  'ja',
  'ko',
  'de',
  'fr',
  'ru',
  'pt',
  'es',
  'it',
] as const
export type TtsIso = (typeof TTS_ALLOWED_ISOS)[number]

export const TTS_DISPLAY: Record<string, string> = {
  auto: 'Auto',
  zh: 'Chinese (zh)',
  en: 'English (en)',
  ja: 'Japanese (ja)',
  ko: 'Korean (ko)',
  de: 'German (de)',
  fr: 'French (fr)',
  ru: 'Russian (ru)',
  pt: 'Portuguese (pt)',
  es: 'Spanish (es)',
  it: 'Italian (it)',
}

export const LANGUAGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Auto' },
  { value: 'zh', label: 'Chinese (zh)' },
  { value: 'en', label: 'English (en)' },
  { value: 'ja', label: 'Japanese (ja)' },
  { value: 'ko', label: 'Korean (ko)' },
  { value: 'de', label: 'German (de)' },
  { value: 'fr', label: 'French (fr)' },
  { value: 'ru', label: 'Russian (ru)' },
  { value: 'pt', label: 'Portuguese (pt)' },
  { value: 'es', label: 'Spanish (es)' },
  { value: 'it', label: 'Italian (it)' },
]

const CARTESIA_LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  pt: 'Portuguese',
  zh: 'Chinese',
  ja: 'Japanese',
  hi: 'Hindi',
  ko: 'Korean',
  it: 'Italian',
  nl: 'Dutch',
  pl: 'Polish',
  ru: 'Russian',
  sv: 'Swedish',
  tr: 'Turkish',
  tl: 'Tagalog',
  bg: 'Bulgarian',
  ro: 'Romanian',
  ar: 'Arabic',
  cs: 'Czech',
  el: 'Greek',
  fi: 'Finnish',
  hr: 'Croatian',
  ms: 'Malay',
  sk: 'Slovak',
  da: 'Danish',
  ta: 'Tamil',
  uk: 'Ukrainian',
  hu: 'Hungarian',
  no: 'Norwegian',
  vi: 'Vietnamese',
  bn: 'Bengali',
  th: 'Thai',
  he: 'Hebrew',
  ka: 'Georgian',
  id: 'Indonesian',
  te: 'Telugu',
  gu: 'Gujarati',
  kn: 'Kannada',
  ml: 'Malayalam',
  mr: 'Marathi',
  pa: 'Punjabi',
  or: 'Odia',
  ur: 'Urdu',
}

/** All 44 base language codes supported by Cartesia sonic-3.6. */
export const CARTESIA_ALLOWED_ISOS: readonly string[] = Object.keys(CARTESIA_LANGUAGE_NAMES)

const CARTESIA_ALLOWED_SET = new Set<string>(CARTESIA_ALLOWED_ISOS)

/** Language dropdown options for the Cartesia provider (Auto + 44). */
export const CARTESIA_LANGUAGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Auto' },
  ...CARTESIA_ALLOWED_ISOS.map((iso) => ({
    value: iso,
    label: `${CARTESIA_LANGUAGE_NAMES[iso]} (${iso})`,
  })),
]

/** Regional locale codes accepted by Cartesia `locale` (docs "Locale codes"). */
export const CARTESIA_LOCALES: readonly string[] = [
  'en-GB',
  'en-US',
  'en-IN',
  'en-IE',
  'en-ZA',
  'en-NZ',
  'en-SG',
  'en-AU',
  'en-CA',
  'es-ES',
  'es-MX',
  'es-US',
  'fr-FR',
  'fr-CA',
  'nl-NL',
  'nl-BE',
  'pt-PT',
  'pt-BR',
  'bg-BG',
  'bn-IN',
  'cs-CZ',
  'da-DK',
  'de-DE',
  'el-GR',
  'fi-FI',
  'gu-IN',
  'he-IL',
  'hi-IN',
  'hr-HR',
  'hu-HU',
  'id-ID',
  'it-IT',
  'ja-JP',
  'ka-GE',
  'kn-IN',
  'ko-KR',
  'ml-IN',
  'mr-IN',
  'ms-MY',
  'no-NO',
  'or-IN',
  'pa-IN',
  'pl-PL',
  'ro-RO',
  'ru-RU',
  'sk-SK',
  'sv-SE',
  'ta-IN',
  'te-IN',
  'th-TH',
  'tl-PH',
  'tr-TR',
  'uk-UA',
  'ur-IN',
  'vi-VN',
  'zh-CN',
]

const CARTESIA_REGION_NAMES: Record<string, string> = {
  GB: 'UK',
  US: 'US',
  IN: 'India',
  IE: 'Ireland',
  ZA: 'South Africa',
  NZ: 'New Zealand',
  SG: 'Singapore',
  AU: 'Australia',
  CA: 'Canada',
  ES: 'Spain',
  MX: 'Mexico',
  FR: 'France',
  NL: 'Netherlands',
  BE: 'Belgium',
  PT: 'Portugal',
  BR: 'Brazil',
  BG: 'Bulgaria',
  CZ: 'Czechia',
  DK: 'Denmark',
  DE: 'Germany',
  GR: 'Greece',
  FI: 'Finland',
  IL: 'Israel',
  HR: 'Croatia',
  HU: 'Hungary',
  ID: 'Indonesia',
  IT: 'Italy',
  JP: 'Japan',
  GE: 'Georgia',
  KR: 'Korea',
  MY: 'Malaysia',
  NO: 'Norway',
  PL: 'Poland',
  RO: 'Romania',
  RU: 'Russia',
  SK: 'Slovakia',
  SE: 'Sweden',
  TH: 'Thailand',
  PH: 'Philippines',
  TR: 'Türkiye',
  UA: 'Ukraine',
  VN: 'Vietnam',
  CN: 'China',
}

/** Locale dropdown options for the Cartesia provider (Auto + regional). */
export const CARTESIA_LOCALE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Auto (same as Language)' },
  ...CARTESIA_LOCALES.map((locale) => {
    const [primary, region] = locale.split('-')
    const base = CARTESIA_LANGUAGE_NAMES[primary] ?? primary
    const where = (region && CARTESIA_REGION_NAMES[region]) ?? region ?? ''
    return { value: locale, label: `${base} — ${where} (${locale})` }
  }),
]

const CARTESIA_LOCALE_SET = new Set<string>(CARTESIA_LOCALES)

/** Canonicalize a Cartesia locale (`en-gb` → `en-GB`); '' when empty/unknown. */
export function normalizeCartesiaLocale(raw: string | null | undefined): string {
  if (raw == null) return ''
  const stripped = String(raw).trim().replace('_', '-')
  if (stripped === '' || stripped.toLowerCase() === 'auto') return ''
  const [primary, region] = stripped.split('-')
  if (!region) {
    const iso = primary.toLowerCase()
    return CARTESIA_ALLOWED_SET.has(iso) ? iso : ''
  }
  const candidate = `${primary.toLowerCase()}-${region.toUpperCase()}`
  return CARTESIA_LOCALE_SET.has(candidate) ? candidate : ''
}

export function isCartesiaLanguageCode(raw: string | null | undefined): boolean {
  if (raw == null) return false
  return CARTESIA_ALLOWED_SET.has(String(raw).trim().toLowerCase().split('-')[0].split('_')[0])
}

/** Keep a stored language for Cartesia, or fall back to Auto when unsupported. */
export function migrateStoredCartesiaLanguage(raw: string | null | undefined): {
  value: string
  isUnknown: boolean
  warning: string | null
} {
  if (raw == null || String(raw).trim() === '' || String(raw).trim().toLowerCase() === 'auto')
    return { value: '', isUnknown: false, warning: null }
  const primary = String(raw).trim().toLowerCase().split('-')[0].split('_')[0]
  if (CARTESIA_ALLOWED_SET.has(primary)) return { value: primary, isUnknown: false, warning: null }
  return {
    value: '',
    isUnknown: true,
    warning: `Unknown language '${String(raw).trim()}' for Cartesia — using Auto`,
  }
}

const LEGACY_ALIAS_TO_ISO: Record<string, string | null> = {
  eng: 'en',
  english: 'en',
  zho: 'zh',
  chinese: 'zh',
  cmn: 'zh',
  jpn: 'ja',
  japanese: 'ja',
  kor: 'ko',
  korean: 'ko',
  deu: 'de',
  ger: 'de',
  german: 'de',
  fra: 'fr',
  fre: 'fr',
  french: 'fr',
  rus: 'ru',
  russian: 'ru',
  por: 'pt',
  portuguese: 'pt',
  spa: 'es',
  spanish: 'es',
  ita: 'it',
  italian: 'it',
  auto: '',
}

const ALLOWED_SET = new Set<string>(TTS_ALLOWED_ISOS)

export function normalizeLanguageCode(raw: string | null | undefined): string {
  if (raw == null) return ''
  const stripped = String(raw).trim()
  if (stripped === '') return ''
  const lower = stripped.toLowerCase()
  if (lower === 'auto') return ''
  const primary = lower.split('-')[0].split('_')[0]
  if (ALLOWED_SET.has(primary)) return primary
  if (primary in LEGACY_ALIAS_TO_ISO) {
    const mapped = LEGACY_ALIAS_TO_ISO[primary]
    return mapped ?? ''
  }
  if (lower in LEGACY_ALIAS_TO_ISO) {
    const mapped = LEGACY_ALIAS_TO_ISO[lower]
    return mapped ?? ''
  }
  if (ALLOWED_SET.has(lower)) return lower
  // unknown -> throw for validation; for migration we treat as unknown
  throw new Error(`unknown language code '${raw}'`)
}

export function isValidLanguageCode(raw: string | null | undefined): boolean {
  if (raw == null || String(raw).trim() === '' || String(raw).trim().toLowerCase() === 'auto')
    return true
  try {
    normalizeLanguageCode(raw)
    return true
  } catch {
    return false
  }
}

export function migrateStoredLanguage(raw: string | null | undefined): {
  value: string
  isUnknown: boolean
  warning: string | null
} {
  if (raw == null || String(raw).trim() === '')
    return { value: '', isUnknown: false, warning: null }
  const lower = String(raw).trim().toLowerCase()
  if (lower === 'auto') return { value: '', isUnknown: false, warning: null }
  const primary = lower.split('-')[0].split('_')[0]
  if (ALLOWED_SET.has(primary)) return { value: primary, isUnknown: false, warning: null }
  if (primary in LEGACY_ALIAS_TO_ISO) {
    const mapped = LEGACY_ALIAS_TO_ISO[primary]
    if (mapped === '' || mapped == null) return { value: '', isUnknown: false, warning: null }
    return { value: mapped, isUnknown: false, warning: null }
  }
  if (lower in LEGACY_ALIAS_TO_ISO) {
    const mapped = LEGACY_ALIAS_TO_ISO[lower]
    if (mapped === '' || mapped == null) return { value: '', isUnknown: false, warning: null }
    return { value: mapped ?? '', isUnknown: false, warning: null }
  }
  if (ALLOWED_SET.has(lower)) return { value: lower, isUnknown: false, warning: null }
  return {
    value: '',
    isUnknown: true,
    warning: `Unknown language '${String(raw).trim()}' — using Auto detection`,
  }
}

export function dropdownValueForStoredLanguage(raw: string | null | undefined): string {
  return migrateStoredLanguage(raw).value
}
