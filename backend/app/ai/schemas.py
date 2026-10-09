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
