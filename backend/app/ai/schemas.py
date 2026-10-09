from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class AiSettingsUpdate(BaseModel):
    endpoint: str | None = None
    model: str | None = None
    temperature: float | None = Field(default=None, ge=0, le=2)
    maxTokens: int | None = Field(default=None, ge=1, le=200000)
    streaming: bool | None = None
    systemPrompt: str | None = None
    apiKey: str | None = None


class AiConversationCreate(BaseModel):
    projectId: str = Field(min_length=1)
    title: str | None = None


class AiConversationRename(BaseModel):
    title: str


class AiChatRequest(BaseModel):
    conversationId: str = Field(min_length=1)
    message: str | None = None
    mode: Literal["send", "regenerate"] = "send"
    context: Any = None


class AiPlanSlideAsset(BaseModel):
    name: str = Field(min_length=1)
    classification: Literal["existing", "missing", "optional"]
    definitionId: str | None = None


class AiPlanSlideIn(BaseModel):
    title: str = Field(min_length=1)
    goal: str = Field(min_length=1)
    estimatedDurationSec: float = Field(ge=0)
    explanation: str = Field(min_length=1)
    suggestedNarration: str = Field(min_length=1)
    requiredAssets: list[AiPlanSlideAsset] = Field(default_factory=list)
    recommendedMaterials: list[str] = Field(default_factory=list)
    recommendedShaders: list[str] = Field(default_factory=list)
    recommendedClips: list[str] = Field(default_factory=list)


class AiPlanContent(BaseModel):
    title: str = Field(min_length=1)
    description: str = ""
    language: str = "en"
    estimatedDurationSec: float = Field(default=0.0, ge=0)
    learningObjective: str = ""
    teachingStrategy: str = ""
    slides: list[AiPlanSlideIn] = Field(min_length=1)


class AiPlanCreate(BaseModel):
    projectId: str = Field(min_length=1)
    conversationId: str = Field(min_length=1)
    request: str = Field(min_length=1)
    context: Any = None
    planId: str | None = None


class AiPlanUpdateSlide(BaseModel):
    id: str = Field(min_length=1)
    title: str | None = None
    goal: str | None = None
    explanation: str | None = None
    suggestedNarration: str | None = None
    estimatedDurationSec: float | None = Field(default=None, ge=0)


class AiPlanUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    language: str | None = None
    estimatedDurationSec: float | None = Field(default=None, ge=0)
    learningObjective: str | None = None
    teachingStrategy: str | None = None
    slides: list[AiPlanUpdateSlide] | None = None
