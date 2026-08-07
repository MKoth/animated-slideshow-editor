# Step 20 – AI Command Execution

## Goal

Transform the AI from a planning assistant into an **editor** that can modify projects safely through the existing Command System.

The AI must **never manipulate project data directly**. Instead, it generates high-level editing intents that are translated into validated editor commands. Every proposed change is presented to the user for review before execution.

This preserves deterministic behavior, full Undo/Redo support, and user trust.

---

# Success Criteria

At the end of this step:

* ✅ AI can propose project edits.
* ✅ Every edit is represented as editor commands.
* ✅ Users review changes before execution.
* ✅ Individual commands can be accepted or rejected.
* ✅ Entire proposals can be accepted or rejected.
* ✅ Executed commands support Undo/Redo.
* ✅ AI never bypasses the Command System.
* ✅ Every AI modification is recorded in project history.

---

# Scope

Implement:

* AI command generation
* Command preview
* Change review UI
* Command execution
* Validation
* Rollback
* AI execution history

Do **not** implement:

* Automatic execution
* Background editing
* Continuous AI agents
* Multi-user editing
* Autonomous project modifications

---

# Architectural Principle

The AI proposes edits—it never performs them directly.

```text id="7q1bvf"
User Request

↓

AI

↓

Edit Proposal

↓

Command List

↓

Validation

↓

User Approval

↓

Command Executor

↓

Project
```

This ensures every project modification follows the same architecture as manual editing.

---

# AI Editing Workflow

Typical flow:

```text id="k9d2mz"
User

↓

"Create a lesson for Yo corro."

↓

AI

↓

Creates proposal

↓

Review Changes

↓

Accept

↓

Commands Execute
```

Nothing changes until the user explicitly approves.

---

# Proposal Model

Introduce an AI Edit Proposal.

Contains:

* id
* title
* description
* confidence (optional)
* affected slides
* commands
* warnings

Future:

* estimated execution time
* generated assets
* required user input

---

# Supported Commands (Initial)

AI may generate:

## Slides

* Create Slide
* Delete Slide
* Rename Slide
* Reorder Slides

---

## Scene

* Add Asset
* Remove Asset
* Duplicate Asset
* Move Asset
* Rotate Asset
* Scale Asset

---

## Materials

* Assign Material
* Change Material Parameters

---

## Animation

* Create Animation Clip
* Assign Animation Clip
* Create Keyframes
* Move Keyframes
* Set Interpolation

---

## Timeline

* Change Duration
* Add Tracks

No shader editing or asset generation yet.

---

# Natural Language Examples

Users should be able to write:

```text id="0kpb4z"
Create six slides explaining present tense.
```

```text id="x6r2an"
Place the boy on the left.
```

```text id="hm4v1q"
Animate the speech bubble to pop in.
```

```text id="8s5vwc"
Move all pronouns slightly higher.
```

The AI converts these requests into structured commands.

---

# Command Translation

Example:

```text id="bt8qnj"
Add a boy.
```

Produces:

```text id="b6w5e3"
CreateObjectCommand

↓

AssignMaterialCommand

↓

MoveObjectCommand
```

The AI never creates editor objects directly.

---

# Validation Layer

Before execution, validate:

* Asset exists
* Material exists
* Animation exists
* References are valid
* No duplicate IDs
* Slide exists
* Commands are internally consistent

Invalid commands are rejected before reaching the project.

---

# Change Review Panel

Create a dedicated review interface.

Suggested layout:

```text id="tw5m87"
AI Proposal

────────────────────

✓ Create Slide

✓ Add Boy

✓ Add Clock

✓ Create Animation

✓ Move Boy

────────────────────

Accept

Reject
```

Each change is individually selectable.

---

# Command Details

Expanding a command shows details.

Example:

```text id="cv0rnb"
Move Object

Object:

Boy

Position:

X 120

Y 350
```

This helps users understand exactly what will happen.

---

# Partial Acceptance

Users may reject individual commands.

Example:

```text id="jlwm201"
✓ Create Slide

✓ Add Boy

✗ Add Clock

✓ Create Animation
```

Only approved commands execute.

---

# Dry Run

Before execution:

Simulate every command.

Verify:

* References resolve
* Constraints satisfied
* No execution failures

Only then allow approval.

---

# Execution

Approved commands execute as a single transaction.

If one command fails:

```text id="jlwm202"
Rollback

↓

Undo All
```

The project never ends in a partially modified state.

---

# Undo / Redo

AI-generated commands are ordinary editor commands.

Therefore:

```text id="jlwm203"
Ctrl + Z

Ctrl + Shift + Z
```

works automatically.

One proposal becomes one Undo transaction.

---

# History

Maintain AI execution history.

Display:

```text id="jlwm204"
Created Lesson

Added Clock

Animated Boy

Placed Bubble
```

Users can inspect previous AI actions.

---

# Conversation Integration

Each accepted proposal links back to the originating conversation.

Example:

```text id="jlwm205"
Conversation

↓

Proposal

↓

Executed Commands
```

This creates traceability between discussions and project changes.

---

# Context

When generating edits, the AI receives:

* Active project
* Slides
* Scene graph
* Asset Library
* Material Library
* Shader Library
* Animation Library
* Selected objects
* Current lesson plan
* Previous accepted AI actions

This allows edits to reuse existing resources intelligently.

---

# Conflict Detection

Detect conflicts such as:

* Missing assets
* Deleted slides
* Duplicate names
* Invalid references
* Incompatible materials

Warn users before execution.

---

# Safety Rules

The AI must never:

* Execute commands automatically.
* Delete user work without explicit approval.
* Access the filesystem directly.
* Modify project files outside the Command System.
* Execute arbitrary code.

Every change is explicit, reviewable, and reversible.

---

# Commands

Introduce AI-specific orchestration commands:

```text id="jlwm206"
CreateAIProposalCommand

ValidateAIProposalCommand

ExecuteAIProposalCommand

RejectAIProposalCommand

RollbackAIProposalCommand
```

These coordinate execution rather than replacing existing editor commands.

---

# Events

Emit:

```text id="jlwm207"
AIProposalCreated

AIProposalValidated

AIProposalApproved

AIProposalRejected

AIProposalExecuted

AIProposalRolledBack
```

---

# Persistence

Persist:

* AI proposals
* Validation results
* Approval status
* Execution history
* Links to originating conversations

Rejected proposals are retained for future reference unless explicitly deleted.

---

# Performance

Requirements:

* Proposal generation should not block the UI.
* Validation should complete quickly for typical projects.
* Large proposals should be virtualized in the review panel.
* Command execution should remain transactional and deterministic.

---

# Future Placeholders

Reserve architecture for:

* AI asset generation
* AI shader generation
* AI animation generation
* Automatic lesson building
* Multi-agent workflows
* Background planning agents
* Voice-driven editing

---

# Testing

Unit tests should verify:

## Proposal Generation

* Natural language requests produce valid command proposals.
* Commands reference existing project resources where appropriate.

---

## Validation

Verify invalid proposals are rejected before execution.

---

## Review

Verify:

* Individual commands can be accepted or rejected.
* Entire proposals can be accepted or rejected.

---

## Transactions

Simulate a failure during execution.

Verify all previously executed commands are rolled back.

---

## Undo

Execute an AI proposal.

Verify a single Undo operation restores the previous project state.

---

## Persistence

Restart the application.

Verify proposals, execution history, and conversation links are restored.

---

# Manual Verification Checklist

## Create Slides

Ask:

```text id="jlwm208"
Create six slides introducing Spanish present tense.
```

Verify a proposal appears instead of immediate project changes.

---

## Review

Expand several proposed commands.

Verify each command clearly describes its intended effect.

---

## Partial Approval

Reject one command (for example, "Add Clock").

Approve the remaining commands.

Verify only approved changes are applied.

---

## Undo

After execution:

Press:

```text id="jlwm209"
Ctrl + Z
```

Verify the entire AI proposal is reverted in one step.

---

## Rollback

Force a validation or execution failure.

Verify no partial modifications remain in the project.

---

## Conversation Link

Open the original AI conversation.

Verify it links to the executed proposal and resulting project changes.

---

## History

Open AI execution history.

Verify accepted proposals are listed chronologically with their execution status.

---

# Deliverables

After Step 20, the editor includes:

* AI-generated edit proposals
* Command translation layer
* Proposal validation
* Interactive review panel
* Partial acceptance
* Transactional execution
* Full Undo/Redo integration
* Execution history
* Conversation-to-command traceability
* Safe, deterministic AI project editing

Direct project manipulation, autonomous editing, and background AI agents are intentionally deferred.

---

# Definition of Done

Step 20 is complete when:

* Users can request project modifications in natural language and receive a clear, reviewable list of proposed editor commands.
* Every accepted change executes through the existing Command System, preserving validation, transactions, Undo/Redo, and deterministic behavior.
* AI editing is transparent, safe, and fully reversible, providing a trustworthy bridge between conversational planning and automated project authoring while establishing the foundation for future AI-generated assets, animations, and complete lesson creation.
