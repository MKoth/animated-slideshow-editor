from datetime import datetime
from typing import Any, cast
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.model import Base


class ClipDefinition(Base):
    """The reusable library record defining a clip."""

    __tablename__ = "clip_definitions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    duration: Mapped[float] = mapped_column(Float, nullable=False)
    category: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    params: Mapped[list[dict[str, object]]] = mapped_column(JSON, nullable=False, default=list)
    channels: Mapped[list[dict[str, object]]] = mapped_column(JSON, nullable=False, default=list)
    channel_animations: Mapped[dict[str, dict[str, object]] | None] = mapped_column(
        JSON, nullable=True, default=None
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    is_builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    seed_version: Mapped[int | None] = mapped_column(Integer, nullable=True)


def _builtin_clip_id(name: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"animated-slideshow-editor/builtin-clip/{name}"))


def _builtin_kf_id(clip_name: str, property: str, time: float) -> str:
    return str(
        uuid5(
            NAMESPACE_URL, f"animated-slideshow-editor/builtin-clip/{clip_name}/{property}/{time}"
        )
    )


def _make_channel_animations(
    clip_name: str, keyframes: list[dict[str, Any]]
) -> dict[str, dict[str, Any]]:
    channels: dict[str, list[dict[str, Any]]] = {}
    for kf in keyframes:
        prop = str(kf["property"])
        time = float(kf["time"])
        value = float(kf["value"])
        channels.setdefault(prop, []).append(
            {
                "id": _builtin_kf_id(clip_name, prop, time),
                "time": time,
                "value": value,
                "interpolation": "linear",
            }
        )
    return {prop: {"keyframes": kfs} for prop, kfs in channels.items()}


BUILTIN_CLIP_NAMES: list[str] = []

BUILTIN_CLIPS: list[dict[str, object]] = []

_raw_builtins: list[dict[str, object]] = [
    {
        "name": "Fade In",
        "duration": 1.0,
        "category": "transition",
        "channels": [{"property": "opacity"}],
        "keyframes": [
            {"property": "opacity", "time": 0, "value": 0},
            {"property": "opacity", "time": 1, "value": 1},
        ],
    },
    {
        "name": "Fade Out",
        "duration": 1.0,
        "category": "transition",
        "channels": [{"property": "opacity"}],
        "keyframes": [
            {"property": "opacity", "time": 0, "value": 1},
            {"property": "opacity", "time": 1, "value": 0},
        ],
    },
    {
        "name": "Pop",
        "duration": 0.5,
        "category": "motion",
        "channels": [{"property": "scaleX"}, {"property": "scaleY"}],
        "keyframes": [
            {"property": "scaleX", "time": 0, "value": 0},
            {"property": "scaleX", "time": 0.5, "value": 1.2},
            {"property": "scaleX", "time": 1, "value": 1},
            {"property": "scaleY", "time": 0, "value": 0},
            {"property": "scaleY", "time": 0.5, "value": 1.2},
            {"property": "scaleY", "time": 1, "value": 1},
        ],
    },
    {
        "name": "Scale Up",
        "duration": 0.75,
        "category": "motion",
        "channels": [{"property": "scaleX"}, {"property": "scaleY"}],
        "keyframes": [
            {"property": "scaleX", "time": 0, "value": 1},
            {"property": "scaleX", "time": 1, "value": 1.5},
            {"property": "scaleY", "time": 0, "value": 1},
            {"property": "scaleY", "time": 1, "value": 1.5},
        ],
    },
    {
        "name": "Scale Down",
        "duration": 0.75,
        "category": "motion",
        "channels": [{"property": "scaleX"}, {"property": "scaleY"}],
        "keyframes": [
            {"property": "scaleX", "time": 0, "value": 1},
            {"property": "scaleX", "time": 1, "value": 0.5},
            {"property": "scaleY", "time": 0, "value": 1},
            {"property": "scaleY", "time": 1, "value": 0.5},
        ],
    },
    {
        "name": "Bounce",
        "duration": 1.0,
        "category": "motion",
        "channels": [{"property": "positionY"}],
        "keyframes": [
            {"property": "positionY", "time": 0, "value": 0},
            {"property": "positionY", "time": 0.25, "value": -50},
            {"property": "positionY", "time": 0.5, "value": 0},
            {"property": "positionY", "time": 0.75, "value": -25},
            {"property": "positionY", "time": 1, "value": 0},
        ],
    },
    {
        "name": "Float",
        "duration": 2.0,
        "category": "motion",
        "channels": [{"property": "positionY"}],
        "keyframes": [
            {"property": "positionY", "time": 0, "value": 0},
            {"property": "positionY", "time": 0.25, "value": -10},
            {"property": "positionY", "time": 0.5, "value": 0},
            {"property": "positionY", "time": 0.75, "value": 10},
            {"property": "positionY", "time": 1, "value": 0},
        ],
    },
    {
        "name": "Shake",
        "duration": 0.5,
        "category": "motion",
        "channels": [{"property": "positionX"}],
        "keyframes": [
            {"property": "positionX", "time": 0, "value": 0},
            {"property": "positionX", "time": 0.1, "value": 5},
            {"property": "positionX", "time": 0.2, "value": -5},
            {"property": "positionX", "time": 0.3, "value": 5},
            {"property": "positionX", "time": 0.4, "value": -5},
            {"property": "positionX", "time": 0.5, "value": 0},
        ],
    },
    {
        "name": "Pulse",
        "duration": 1.0,
        "category": "motion",
        "channels": [{"property": "scaleX"}, {"property": "scaleY"}],
        "keyframes": [
            {"property": "scaleX", "time": 0, "value": 1},
            {"property": "scaleX", "time": 0.5, "value": 1.1},
            {"property": "scaleX", "time": 1, "value": 1},
            {"property": "scaleY", "time": 0, "value": 1},
            {"property": "scaleY", "time": 0.5, "value": 1.1},
            {"property": "scaleY", "time": 1, "value": 1},
        ],
    },
    {
        "name": "Rotate",
        "duration": 1.0,
        "category": "motion",
        "channels": [{"property": "rotation"}],
        "keyframes": [
            {"property": "rotation", "time": 0, "value": 0},
            {"property": "rotation", "time": 1, "value": 360},
        ],
    },
    {
        "name": "Blink",
        "duration": 0.8,
        "category": "motion",
        "channels": [{"property": "opacity"}],
        "keyframes": [
            {"property": "opacity", "time": 0, "value": 1},
            {"property": "opacity", "time": 0.1, "value": 0},
            {"property": "opacity", "time": 0.2, "value": 1},
            {"property": "opacity", "time": 0.3, "value": 0},
            {"property": "opacity", "time": 0.4, "value": 1},
        ],
    },
    {
        "name": "Wobble",
        "duration": 1.0,
        "category": "motion",
        "channels": [{"property": "rotation"}],
        "keyframes": [
            {"property": "rotation", "time": 0, "value": 0},
            {"property": "rotation", "time": 0.25, "value": 10},
            {"property": "rotation", "time": 0.5, "value": -10},
            {"property": "rotation", "time": 0.75, "value": 5},
            {"property": "rotation", "time": 1, "value": 0},
        ],
    },
    {
        "name": "Slide Left",
        "duration": 0.75,
        "category": "motion",
        "channels": [{"property": "positionX"}],
        "keyframes": [
            {"property": "positionX", "time": 0, "value": 100},
            {"property": "positionX", "time": 1, "value": 0},
        ],
    },
    {
        "name": "Slide Right",
        "duration": 0.75,
        "category": "motion",
        "channels": [{"property": "positionX"}],
        "keyframes": [
            {"property": "positionX", "time": 0, "value": -100},
            {"property": "positionX", "time": 1, "value": 0},
        ],
    },
    {
        "name": "Appear",
        "duration": 0.01,
        "category": "transition",
        "channels": [{"property": "opacity"}],
        "keyframes": [{"property": "opacity", "time": 0, "value": 1}],
    },
    {
        "name": "Disappear",
        "duration": 0.01,
        "category": "transition",
        "channels": [{"property": "opacity"}],
        "keyframes": [{"property": "opacity", "time": 0, "value": 0}],
    },
    {
        "name": "Speech Bubble Pop",
        "duration": 0.5,
        "category": "ui",
        "channels": [
            {"property": "scaleX"},
            {"property": "scaleY"},
            {"property": "opacity"},
        ],
        "keyframes": [
            {"property": "scaleX", "time": 0, "value": 0},
            {"property": "scaleX", "time": 0.5, "value": 1.2},
            {"property": "scaleX", "time": 1, "value": 1},
            {"property": "scaleY", "time": 0, "value": 0},
            {"property": "scaleY", "time": 0.5, "value": 1.2},
            {"property": "scaleY", "time": 1, "value": 1},
            {"property": "opacity", "time": 0, "value": 0},
            {"property": "opacity", "time": 0.5, "value": 1},
        ],
    },
    {
        "name": "Clock Tick",
        "duration": 0.5,
        "category": "ui",
        "channels": [{"property": "rotation"}],
        "keyframes": [
            {"property": "rotation", "time": 0, "value": 0},
            {"property": "rotation", "time": 0.5, "value": 30},
        ],
    },
    {
        "name": "Point",
        "duration": 0.5,
        "category": "ui",
        "channels": [{"property": "rotation"}],
        "keyframes": [
            {"property": "rotation", "time": 0, "value": 0},
            {"property": "rotation", "time": 0.25, "value": -20},
            {"property": "rotation", "time": 0.5, "value": 0},
        ],
    },
    {
        "name": "Wave",
        "duration": 1.5,
        "category": "motion",
        "channels": [{"property": "rotation"}],
        "keyframes": [
            {"property": "rotation", "time": 0, "value": 0},
            {"property": "rotation", "time": 0.1667, "value": 20},
            {"property": "rotation", "time": 0.3333, "value": -20},
            {"property": "rotation", "time": 0.5, "value": 20},
            {"property": "rotation", "time": 0.6667, "value": -20},
            {"property": "rotation", "time": 0.8333, "value": 10},
            {"property": "rotation", "time": 1, "value": 0},
        ],
    },
    {
        "name": "Jump",
        "duration": 0.75,
        "category": "motion",
        "channels": [{"property": "positionY"}, {"property": "scaleY"}],
        "keyframes": [
            {"property": "positionY", "time": 0, "value": 0},
            {"property": "positionY", "time": 0.25, "value": -80},
            {"property": "positionY", "time": 0.5, "value": 0},
            {"property": "scaleY", "time": 0, "value": 1},
            {"property": "scaleY", "time": 0.125, "value": 0.8},
            {"property": "scaleY", "time": 0.25, "value": 1.2},
            {"property": "scaleY", "time": 0.5, "value": 1},
        ],
    },
]

for _raw in _raw_builtins:
    _name = str(_raw["name"])
    BUILTIN_CLIP_NAMES.append(_name)
    BUILTIN_CLIPS.append(
        {
            "id": _builtin_clip_id(_name),
            "name": _name,
            "duration": float(cast(Any, _raw["duration"])),
            "category": str(_raw["category"]),
            "params": [],
            "channels": list(cast(Any, _raw["channels"])),
            "channel_animations": _make_channel_animations(
                _name, list(cast(Any, _raw["keyframes"]))
            ),
            "seed_version": 1,
        }
    )
