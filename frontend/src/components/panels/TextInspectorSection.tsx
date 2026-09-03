import type { SceneNode } from '../../engine'
import type { TextAlignment } from '../../engine/components'
import type { DispatchCommand } from '../../engine/commands'
import {
  SetTextAlignmentCommand,
  SetTextContentCommand,
  SetTextFontSizeCommand,
  SplitIntoMorphemesCommand,
  TransactionCommand,
} from '../../engine/commands'
import { NumericField, NameField } from './inspectorFields'
import { runCommand } from './sectionHelpers'

function commonTextValue<T>(targets: readonly SceneNode[], get: (n: SceneNode) => T): T | null {
  if (targets.length === 0) return null
  const first = get(targets[0] as SceneNode)
  for (let i = 1; i < targets.length; i++) {
    if (get(targets[i] as SceneNode) !== first) return null
  }
  return first
}

export function TextInspectorSection({
  target,
  dispatch,
  notify,
  playing,
}: {
  target: SceneNode
  dispatch: DispatchCommand
  notify: (message: string) => void
  playing: boolean
}) {
  const text = target.components.text
  if (!text) return null

  const commitContent = (raw: string) => {
    runCommand(notify, () => {
      return dispatch(new SetTextContentCommand({ nodeId: target.id, content: raw }))
    })
  }

  const commitFontSize = (raw: string) => {
    const value = Number(raw)
    if (Number.isFinite(value) && value > 0) {
      runCommand(notify, () => {
        return dispatch(new SetTextFontSizeCommand({ nodeId: target.id, fontSize: value }))
      })
    }
  }

  const adjustFontSize = (value: number) => {
    runCommand(notify, () => {
      return dispatch(new SetTextFontSizeCommand({ nodeId: target.id, fontSize: value }))
    })
  }

  const commitAlignment = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const alignment = event.target.value as TextAlignment
    runCommand(notify, () => {
      return dispatch(new SetTextAlignmentCommand({ nodeId: target.id, alignment }))
    })
  }

  const handleSplitMorphemes = () => {
    const input = prompt('Enter segments separated by commas:', text.content)
    if (input === null) return
    const segments = input
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    if (segments.length === 0) {
      notify('No segments provided')
      return
    }
    runCommand(notify, () => {
      return dispatch(new SplitIntoMorphemesCommand({ nodeId: target.id, segments }))
    })
  }

  return (
    <section className="inspector-section">
      <h3 className="inspector-section__title">Text</h3>

      <NameField label="Content" value={text.content} disabled={playing} onCommit={commitContent} />

      <NumericField
        label="Font Size"
        value={text.fontSize}
        step={1}
        disabled={playing}
        onCommit={commitFontSize}
        onAdjust={adjustFontSize}
      />

      <div className="inspector-field">
        <label className="inspector-field__label" htmlFor="text-alignment">
          Alignment
        </label>
        <select
          id="text-alignment"
          className="inspector-field__input inspector-field__select"
          aria-label="Alignment"
          disabled={playing}
          value={text.alignment}
          onChange={commitAlignment}
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </div>

      <button className="inspector-reset" disabled={playing} onClick={handleSplitMorphemes}>
        Split into Morphemes
      </button>
    </section>
  )
}

export function TextMultiInspector({
  targets,
  dispatch,
  notify,
  playing,
}: {
  targets: readonly SceneNode[]
  dispatch: DispatchCommand
  notify: (message: string) => void
  playing: boolean
}) {
  if (targets.length === 0) return null
  const commonFontSize = commonTextValue(targets, (n) => n.components.text!.fontSize)
  const commonAlignment = commonTextValue(targets, (n) => n.components.text!.alignment)

  const commitFontSize = (raw: string) => {
    const value = Number(raw)
    if (!Number.isFinite(value) || value <= 0) return
    const cmds = targets.map((t) => new SetTextFontSizeCommand({ nodeId: t.id, fontSize: value }))
    runCommand(notify, () => dispatch(new TransactionCommand(cmds as never)))
  }
  const adjustFontSize = (value: number) => {
    const cmds = targets.map((t) => new SetTextFontSizeCommand({ nodeId: t.id, fontSize: value }))
    runCommand(notify, () => dispatch(new TransactionCommand(cmds as never)))
  }
  const commitAlignment = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const alignment = event.target.value as TextAlignment
    const cmds = targets.map((t) => new SetTextAlignmentCommand({ nodeId: t.id, alignment }))
    runCommand(notify, () => dispatch(new TransactionCommand(cmds as never)))
  }

  return (
    <section className="inspector-section">
      <h3 className="inspector-section__title">Text — {targets.length} selected</h3>
      <NumericField
        label="Font Size"
        value={commonFontSize}
        step={1}
        disabled={playing}
        onCommit={commitFontSize}
        onAdjust={adjustFontSize}
      />
      <div className="inspector-field">
        <label className="inspector-field__label" htmlFor="text-alignment-multi">
          Alignment
        </label>
        <select
          id="text-alignment-multi"
          className="inspector-field__input inspector-field__select"
          aria-label="Alignment"
          disabled={playing}
          value={commonAlignment ?? ''}
          onChange={commitAlignment}
        >
          {commonAlignment === null && (
            <option value="" disabled>
              — Mixed —
            </option>
          )}
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </div>
    </section>
  )
}
