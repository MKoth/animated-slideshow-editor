from __future__ import annotations

# Canonical Qwen3-TTS languages: Auto + 10
# Store as iso lowercased; Auto is None (disables explicit language)

ALLOWED_TTS_ISOS: set[str] = {"zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"}

# Display label for dropdown: friendly name + iso tag
TTS_ISO_TO_DISPLAY: dict[str, str] = {
    "auto": "Auto",
    "zh": "Chinese (zh)",
    "en": "English (en)",
    "ja": "Japanese (ja)",
    "ko": "Korean (ko)",
    "de": "German (de)",
    "fr": "French (fr)",
    "ru": "Russian (ru)",
    "pt": "Portuguese (pt)",
    "es": "Spanish (es)",
    "it": "Italian (it)",
}

# Qwen language string (capitalised) for model
ISO_TO_QWEN: dict[str, str] = {
    "zh": "Chinese",
    "en": "English",
    "ja": "Japanese",
    "ko": "Korean",
    "de": "German",
    "fr": "French",
    "ru": "Russian",
    "pt": "Portuguese",
    "es": "Spanish",
    "it": "Italian",
    "auto": "Auto",
}

# Legacy alias -> iso (lowercased keys). Includes 639-2 and full names.
LEGACY_ALIAS_TO_ISO: dict[str, str | None] = {
    "eng": "en",
    "english": "en",
    "zho": "zh",
    "chinese": "zh",
    "cmn": "zh",
    "jpn": "ja",
    "japanese": "ja",
    "kor": "ko",
    "korean": "ko",
    "deu": "de",
    "ger": "de",
    "german": "de",
    "fra": "fr",
    "fre": "fr",
    "french": "fr",
    "rus": "ru",
    "russian": "ru",
    "por": "pt",
    "portuguese": "pt",
    "spa": "es",
    "spanish": "es",
    "ita": "it",
    "italian": "it",
    "auto": None,
}


def _extract_primary(raw: str) -> str:
    key = raw.strip().lower()
    primary = key.split("-")[0].split("_")[0]
    return primary


def normalize_language_code(raw: str | None) -> str | None:
    """Normalize to iso lowercased or None (Auto).

    Returns None for Auto / empty. Returns iso lowercased for allowed languages
    (including locale forms like en-US -> en, case-insensitive).
    Raises ValueError for unknown codes.
    """
    if raw is None:
        return None
    stripped = raw.strip()
    if stripped == "":
        return None
    lower = stripped.lower()
    if lower == "auto":
        return None
    # Primary tag before - or _
    primary = lower.split("-")[0].split("_")[0]
    if primary in ALLOWED_TTS_ISOS:
        return primary
    # Check legacy alias for primary or full lower
    if primary in LEGACY_ALIAS_TO_ISO:
        mapped = LEGACY_ALIAS_TO_ISO[primary]
        return mapped  # None for auto, else iso
    if lower in LEGACY_ALIAS_TO_ISO:
        return LEGACY_ALIAS_TO_ISO[lower]
    # Also direct check full lower is iso? Already covered primary==iso,
    # but handle case where raw is exact iso with no split needed
    if lower in ALLOWED_TTS_ISOS:
        return lower
    raise ValueError(
        f"unknown language code '{raw}'; must be one of Auto, {', '.join(sorted(ALLOWED_TTS_ISOS))}"
    )


def is_valid_language_code(raw: str | None) -> bool:
    try:
        normalize_language_code(raw)
        return True
    except ValueError:
        return False


def dropdown_display_for_iso(iso: str | None) -> str:
    if iso is None:
        return TTS_ISO_TO_DISPLAY["auto"]
    return TTS_ISO_TO_DISPLAY.get(iso, iso)


# Ordered options for dropdown: Auto first, then alphabetical by display?
# Spec shows Auto + Chinese, English, Japanese, Korean, German, French, Russian, Portuguese, Spanish, Italian
# We'll keep that order: auto, zh, en, ja, ko, de, fr, ru, pt, es, it
DROPDOWN_ORDER: list[str] = ["auto", "zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"]

LANGUAGE_OPTIONS: list[dict[str, str]] = [
    {"value": "", "label": TTS_ISO_TO_DISPLAY["auto"]}
    if iso == "auto"
    else {"value": iso, "label": TTS_ISO_TO_DISPLAY[iso]}
    for iso in DROPDOWN_ORDER
]


# Helper for frontend migration: map stored raw to dropdown value ("" for Auto) with warning flag
def migrate_stored_language(raw: str | None) -> tuple[str, bool, str | None]:
    """Return (dropdown_value, is_unknown, warning).

    dropdown_value is "" for Auto or iso lowercased for known.
    is_unknown True if raw was non-empty/non-auto but not mappable.
    warning is human readable if unknown.
    """
    if raw is None or (isinstance(raw, str) and raw.strip() == ""):
        return "", False, None
    raw_str = str(raw)
    lower = raw_str.strip().lower()
    if lower == "auto":
        return "", False, None
    try:
        normalized = normalize_language_code(raw_str)
        if normalized is None:
            return "", False, None
        return normalized, False, None
    except ValueError:
        return "", True, f"Unknown language '{raw_str}' — using Auto detection"
