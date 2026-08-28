import type { SceneNode } from '../../engine'
import type { TextAlignment } from '../../engine/components'
import type { DispatchCommand } from '../../engine/commands'
import {
  SetTextAlignmentCommand,
  SetTextContentCommand,
  SetTextFontSizeCommand,
  SplitIntoMorphemesCommand,
} from '../../engine/commands'
import { NumericField, NameField } from './inspectorFields'
import { runCommand } from './sectionHelpers'

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
