# Step 18 – AI Assistant (Chat Foundation)

## Goal

Implement the **AI Assistant** as a first-class component of the editor.

At this stage, the AI behaves purely as a conversational assistant. It can answer questions, explain features, discuss animation ideas, suggest lesson scenarios, and help plan educational content—but it **cannot modify the project** yet.

This step establishes the entire AI infrastructure that later steps will use for project editing, asset generation, animation creation, and lesson authoring.

---

# Success Criteria

At the end of this step:

* ✅ AI panel exists.
* ✅ Conversations persist within the project.
* ✅ Multiple conversations are supported.
* ✅ Streaming responses work.
* ✅ Markdown rendering works.
* ✅ Code blocks are highlighted.
* ✅ Chat history is searchable.
* ✅ AI has read-only access to the current project.

No project modifications are allowed.

---

# Scope

Implement:

* AI chat panel
* Conversation management
* Streaming responses
* Markdown rendering
* Chat persistence
* Conversation search
* Read-only project context

Do **not** implement:

* Tool calling
* Project editing
* Asset generation
* Image generation
* Animation generation
* Command execution

---

# Architectural Principle

The AI is initially an **advisor**, not an editor.

```text id="8xh3m7"
User

↓

AI Chat

↓

LLM

↓

Response
```

No connection to the Command System yet.

---

# Layout

Add a dockable AI panel.

Suggested layout:

```text id="4v5p0j"
+--------------------------------------------------+

AI Assistant

----------------------------------------------------

Conversation List

----------------------------------------------------

Conversation

----------------------------------------------------

Message Input

----------------------------------------------------
```

The panel should be resizable and dockable alongside the existing editor panels.

---

# Conversation List

Support multiple conversations.

Example:

```text id="lm0r8d"
Present Tense Ideas

Fish Animation

Shaders

Lesson Plan

Spanish Verbs
```

Users can:

* Create
* Rename
* Delete
* Archive (optional)

---

# Conversation Model

Each conversation stores:

* id
* title
* created date
* modified date
* messages

Future metadata:

* related slide
* related asset
* related project objects

---

# Message Model

Each message contains:

* id
* role (User / Assistant / System)
* content
* timestamp

Future:

* attachments
* tool calls
* images
* generated assets

---

# Message Rendering

Support Markdown:

* Headings
* Lists
* Tables
* Quotes
* Links
* Code blocks
* Inline code

Syntax highlighting for:

* TypeScript
* GLSL
* Python
* JSON
* Markdown

---

# Streaming

Responses should stream token-by-token.

Benefits:

* Faster perceived response time.
* Natural conversation feel.
* Ability to cancel long responses.

---

# Stop Generation

User can interrupt generation.

Button:

```text id="4b8qtx"
Stop
```

Streaming stops immediately while preserving the partial response.

---

# Regenerate

Support:

```text id="e7d8mx"
Regenerate Response
```

Creates a new assistant reply without removing previous history.

Future versions may display alternative branches.

---

# Conversation Search

Search across:

* Conversation titles
* User messages
* Assistant responses

Results should update instantly.

---

# Project Context

The AI receives read-only context, including:

* Project name
* Active slide
* Slide list
* Scene hierarchy
* Selected objects
* Materials
* Shader names
* Animation clip names

This enables contextual answers without permitting modifications.

---

# Context Provider

Introduce a Context Provider.

Responsibilities:

* Build compact project summaries.
* Provide selected object information.
* Limit context size.
* Hide implementation details from the UI.

Example summary:

```text id="qjlwm2"
Project:
Spanish Present Tense

Slide:
Yo Corro

Selected:
Boy

Animations:
Fade In
Point

Materials:
Default Character
```

---

# Token Budget

Introduce context management.

Prioritize:

1. Current conversation.
2. Selected objects.
3. Active slide.
4. Project summary.
5. Older conversation history.

Avoid sending the entire project when unnecessary.

---

# AI Settings

Create an AI settings section.

Configurable:

* Provider
* Model
* Temperature
* Max Tokens
* Streaming
* System Prompt

Future:

* Vision
* Tool permissions
* Memory

---

# Provider Abstraction

Define a provider interface.

Suggested methods:

* sendMessage()
* streamMessage()
* cancelRequest()

Initially support one provider, but the architecture should allow adding:

* OpenAI
* Anthropic
* Google
* Local LLM (Ollama)
* Custom providers

without changing the chat UI.

---

# Error Handling

Handle gracefully:

* Network errors
* Timeouts
* Authentication failures
* Rate limits
* Invalid responses

Display retry options without losing conversation history.

---

# Commands

Introduce AI-related commands:

```text id="jlwm91"
CreateConversationCommand

RenameConversationCommand

DeleteConversationCommand

SendMessageCommand

CancelGenerationCommand

RegenerateResponseCommand
```

These manage editor state only; they do not modify the project.

---

# Events

Emit:

```text id="jlwm93"
ConversationCreated

ConversationDeleted

MessageSent

MessageReceived

StreamingStarted

StreamingFinished

StreamingCancelled
```

---

# Persistence

Persist:

* Conversations
* Messages
* Draft input
* Active conversation

Project context is regenerated on load and is not serialized into the conversation.

---

# Performance

Requirements:

* Large conversations remain responsive.
* Streaming does not block the UI.
* Markdown rendering is virtualized for long chats.
* Conversation switching is instantaneous.

---

# Security

The AI must:

* Never execute project modifications.
* Never call internal editor commands.
* Never access the filesystem directly.
* Never modify assets or shaders.

All responses are advisory only.

---

# Future Placeholders

Reserve architecture for:

* Tool calling
* Asset generation
* Image generation
* Shader generation
* Animation generation
* Project editing
* Long-term AI memory

---

# Testing

Unit tests should verify:

## Conversations

* Create
* Rename
* Delete
* Persistence

---

## Messages

* Send
* Receive
* Streaming
* Cancellation

---

## Markdown

Verify rendering of:

* Lists
* Tables
* Code blocks
* Links

---

## Search

Verify searching by title and message content.

---

## Context

Verify the Context Provider returns the correct active project summary.

---

## Error Handling

Simulate:

* Timeout
* Network failure
* Authentication error

Verify user-friendly recovery.

---

# Manual Verification Checklist

## Conversation

Create several conversations.

Verify switching is instantaneous.

---

## Chat

Ask:

```text id="jlwm94"
Explain Spanish present tense.
```

Verify streamed response appears correctly.

---

## Markdown

Ask for:

```text id="jlwm95"
Generate GLSL example.
```

Verify syntax highlighting.

---

## Search

Search for:

```text id="jlwm96"
shader
```

Verify matching conversations and messages are found.

---

## Context

Select a different slide.

Ask:

```text id="jlwm97"
What slide am I editing?
```

Verify the AI answers using the active project context.

---

## Stop

Begin generating a long response.

Press:

```text id="jlwm98"
Stop
```

Verify generation halts immediately and the partial response remains visible.

---

## Restart

Close and reopen the project.

Verify:

* Conversations restored.
* Messages restored.
* Active conversation restored.

---

# Deliverables

After Step 18, the editor includes:

* Dockable AI panel
* Multi-conversation management
* Streaming chat
* Markdown rendering
* Syntax-highlighted code blocks
* Conversation search
* Read-only project context
* Provider abstraction
* AI settings
* Persistent conversation history
* Robust error handling

Project editing, tool execution, and AI-generated assets are intentionally deferred.

---

# Definition of Done

Step 18 is complete when:

* Users can have persistent, context-aware conversations with the AI directly inside the editor.
* The AI understands the active project and can provide relevant guidance without modifying any project data.
* Conversations are organized, searchable, and streamed smoothly, creating a solid foundation for future AI capabilities.
* The architecture cleanly separates conversational AI from editor actions, preparing the system for command-driven AI editing, asset generation, shader authoring, and automated lesson creation in subsequent steps.
