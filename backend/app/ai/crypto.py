"""Fernet key encryption + masked-tail reads."""

# ruff: noqa: BLE001, S110
from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken


def mask_key(plaintext: str | None) -> str:
    if not plaintext:
        return ""
    tail = plaintext[-4:] if len(plaintext) >= 4 else plaintext
    return f"••••••••{tail}"


def encrypt_key(plaintext: str, secret: str) -> str:
    fernet = _fernet_for_secret(secret)
    return fernet.encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_key(ciphertext: str, secret: str) -> str:
    fernet = _fernet_for_secret(secret)
    try:
        return fernet.decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("stored AI key cannot be decrypted with AI_SECRET_KEY") from exc


def _fernet_for_secret(secret: str) -> Fernet:
    raw = secret.strip().encode("utf-8")
    # Accept a raw Fernet key (44-char base64) or derive one from any passphrase.
    try:
        return Fernet(raw.decode("utf-8"))
    except Exception:
        pass
    # Derive a stable 32-byte key from the passphrase via SHA-256 + urlsafe base64.
    import base64
    import hashlib

    digest = hashlib.sha256(raw).digest()
    return Fernet(base64.urlsafe_b64encode(digest).decode("utf-8"))
