ASSET_CATEGORIES: tuple[str, ...] = (
    "Character",
    "Character Part",
    "Animal",
    "Plant",
    "Object",
    "Background",
    "UI",
    "Decoration",
    "Speech Bubble",
    "Icon",
    "Effect",
    "Particle",
    "Text",
    "Uncategorized",
)

DEFAULT_ASSET_CATEGORY = "Uncategorized"

CANONICAL_CATEGORIES: frozenset[str] = frozenset(ASSET_CATEGORIES)


class CategoryValidationError(ValueError):
    """Raised when a category is not part of the canonical vocabulary."""


def validate_category(category: str) -> None:
    if category not in CANONICAL_CATEGORIES:
        raise CategoryValidationError(f"'{category}' is not a canonical asset category")
