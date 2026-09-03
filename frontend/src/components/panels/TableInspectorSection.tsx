import { useState } from 'react'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import { useUiStore } from '../../stores/uiStore'
import { usePlaybackController } from '../../stores/playbackStore'
import type { SceneNode } from '../../engine'
import type { TableComponent, TableDimension } from '../../engine/components'
import type { DispatchCommand } from '../../engine/commands'
import {
  SetTableComponentCommand,
  AddTableRowCommand,
  RemoveTableRowCommand,
  AddTableColumnCommand,
  RemoveTableColumnCommand,
  SetTableCellComponentCommand,
  AddKeyframeCommand,
  SetKeyframeValueCommand,
} from '../../engine/commands'
import type { TableAnimationProperty } from '../../engine/animationProperties'
import { NumericField } from './inspectorFields'
import { runCommand } from './sectionHelpers'

function mergeTable(node: SceneNode, patch: Partial<TableComponent>): TableComponent {
  const t = node.components.table!
  return { ...t, ...patch }
}

function commitDimensionWidths(
  node: SceneNode,
  key: 'columns',
  index: number,
  raw: string,
): Partial<TableComponent> {
  const dims = [...node.components.table![key]] as TableDimension[]
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return {}
  dims[index] = { ...dims[index], width: value }
  return { [key]: dims }
}

export function TableInspectorSection({
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
  if (target.components.table) {
    return (
      <TableLevelInspector target={target} dispatch={dispatch} notify={notify} playing={playing} />
    )
  }

  if (target.components.tableCell) {
    return (
      <TableCellInspector target={target} dispatch={dispatch} notify={notify} playing={playing} />
    )
  }

  return null
}

function TableLevelInspector({
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
  const { engine } = useEngine()
  const animationMode = useUiStore((s) => s.animationMode)
  const [, setTick] = useState(0)
  useEngineEvent(() => setTick((t) => t + 1))
  usePlaybackController((s) => s.currentTimes)

  const table = target.components.table
  if (!table) return null

  const slide = engine.getActiveSlide()
  const slideId = slide?.id ?? null
  const playheadTime = slideId ? (usePlaybackController.getState().getTime(slideId) ?? 0) : 0
  const evaluated =
    slideId && (animationMode || playing) ? engine.evaluateTable(target.id, playheadTime) : null
  const displayBorderRadius = evaluated?.borderRadius ?? table.borderRadius ?? 0
  const displayPadding = evaluated?.padding ?? table.padding ?? 0

  const isAnimated = (prop: TableAnimationProperty) => engine.hasTableTrack(target.id, prop)

  const commitTableField = (property: TableAnimationProperty, value: number) => {
    if (animationMode && slideId) {
      const time = usePlaybackController.getState().getTime(slideId)
      const existing = engine.getTableKeyframes(target.id, property).find((kf) => kf.time === time)
      try {
        if (existing) {
          const result = dispatch(
            new SetKeyframeValueCommand({
              target: { kind: 'table', nodeId: target.id, property },
              keyframeId: existing.id,
              newValue: value,
            }),
          )
          if (!result.ok) throw result.error
          return
        }
        const result = dispatch(
          new AddKeyframeCommand({
            target: { kind: 'table', nodeId: target.id, property },
            time,
            value,
          }),
        )
        if (!result.ok) throw result.error
        return
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error))
        return
      }
    }
    runCommand(notify, () => {
      const updated = mergeTable(target, { [property]: value } as Partial<TableComponent>)
      return dispatch(new SetTableComponentCommand({ nodeId: target.id, table: updated }))
    })
  }

  const apply = (patch: Partial<TableComponent>) => {
    runCommand(notify, () => {
      const updated = mergeTable(target, patch)
      return dispatch(new SetTableComponentCommand({ nodeId: target.id, table: updated }))
    })
  }

  const commitGap = (raw: string) => {
    const value = Number(raw)
    if (Number.isFinite(value) && value >= 0) {
      apply({ gap: value })
    }
  }

  const commitBorderWidth = (raw: string) => {
    const value = Number(raw)
    if (Number.isFinite(value) && value >= 0) {
      apply({ borderWidth: value })
    }
  }

  const commitBorderColor = (event: React.ChangeEvent<HTMLInputElement>) => {
    apply({ borderColor: event.target.value })
  }

  const commitBackground = (event: React.ChangeEvent<HTMLInputElement>) => {
    apply({ background: event.target.value })
  }

  const commitColumnWidth = (index: number, raw: string) => {
    apply(commitDimensionWidths(target, 'columns', index, raw))
  }

  const addRow = () => {
    runCommand(notify, () => {
      return dispatch(new AddTableRowCommand({ tableNodeId: target.id, index: -1 }))
    })
  }

  const removeRow = () => {
    if (target.children.length === 0) return
    const lastRow = target.children[target.children.length - 1]
    runCommand(notify, () => {
      return dispatch(new RemoveTableRowCommand({ rowNodeId: lastRow.id }))
    })
  }

  const addColumn = () => {
    runCommand(notify, () => {
      return dispatch(new AddTableColumnCommand({ tableNodeId: target.id, index: -1 }))
    })
  }

  const removeColumn = () => {
    if (table.columns.length <= 1) return
    runCommand(notify, () => {
      return dispatch(
        new RemoveTableColumnCommand({
          tableNodeId: target.id,
          columnIndex: table.columns.length - 1,
        }),
      )
    })
  }

  return (
    <section className="inspector-section">
      <h3 className="inspector-section__title">Table</h3>

      {table.columns.map((col, i) => (
        <NumericField
          key={`col-${i}`}
          label={`Column ${i + 1} Width`}
          value={typeof col.width === 'number' ? col.width : null}
          step={1}
          disabled={playing || col.width === 'auto'}
          onCommit={(raw) => commitColumnWidth(i, raw)}
          onAdjust={(value) =>
            apply({
              columns: table.columns.map((c, ci) => (ci === i ? { ...c, width: value } : c)),
            })
          }
        />
      ))}

      <NumericField
        label="Gap"
        value={table.gap}
        step={1}
        disabled={playing}
        onCommit={commitGap}
        onAdjust={(value) => apply({ gap: value })}
      />

      <NumericField
        label="Border Width"
        value={table.borderWidth}
        step={0.5}
        disabled={playing}
        onCommit={commitBorderWidth}
        onAdjust={(value) => apply({ borderWidth: value })}
      />

      <NumericField
        label="Border Radius"
        value={displayBorderRadius}
        step={1}
        disabled={playing || (!animationMode && isAnimated('borderRadius'))}
        onCommit={(raw) => {
          const v = Number(raw)
          if (!Number.isFinite(v) || v < 0) {
            notify('Border radius must be a non-negative number')
            return
          }
          commitTableField('borderRadius', v)
        }}
        onAdjust={(value) => commitTableField('borderRadius', Math.max(0, value))}
      />

      <NumericField
        label="Padding"
        value={displayPadding}
        step={1}
        disabled={playing || (!animationMode && isAnimated('padding'))}
        onCommit={(raw) => {
          const v = Number(raw)
          if (!Number.isFinite(v) || v < 0) {
            notify('Padding must be a non-negative number')
            return
          }
          commitTableField('padding', v)
        }}
        onAdjust={(value) => commitTableField('padding', Math.max(0, value))}
      />

      <div className="inspector-field">
        <label className="inspector-field__label" htmlFor="table-border-color">
          Border Color
        </label>
        <input
          id="table-border-color"
          className="inspector-field__color"
          type="color"
          aria-label="Border Color"
          value={table.borderColor}
          disabled={playing}
          onChange={commitBorderColor}
        />
      </div>

      <div className="inspector-field">
        <label className="inspector-field__label" htmlFor="table-background">
          Background
        </label>
        <input
          id="table-background"
          className="inspector-field__color"
          type="color"
          aria-label="Background"
          value={table.background ?? '#ffffff'}
          disabled={playing}
          onChange={commitBackground}
        />
      </div>

      <div className="inspector-field inspector-field--buttons">
        <button
          className="inspector-field__button"
          disabled={playing}
          onClick={addRow}
          title="Add Row"
        >
          + Row
        </button>
        <button
          className="inspector-field__button"
          disabled={playing || target.children.length <= 1}
          onClick={removeRow}
          title="Remove Row"
        >
          - Row
        </button>
        <button
          className="inspector-field__button"
          disabled={playing}
          onClick={addColumn}
          title="Add Column"
        >
          + Column
        </button>
        <button
          className="inspector-field__button"
          disabled={playing || table.columns.length <= 1}
          onClick={removeColumn}
          title="Remove Column"
        >
          - Column
        </button>
      </div>
    </section>
  )
}

function TableCellInspector({
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
  const { engine } = useEngine()
  const animationMode = useUiStore((s) => s.animationMode)
  const [, setTick] = useState(0)
  useEngineEvent(() => setTick((t) => t + 1))
  usePlaybackController((s) => s.currentTimes)

  const cell = target.components.tableCell
  if (!cell) return null

  const slide = engine.getActiveSlide()
  const slideId = slide?.id ?? null
  const playheadTime = slideId ? (usePlaybackController.getState().getTime(slideId) ?? 0) : 0
  const evaluated =
    slideId && (animationMode || playing) ? engine.evaluateTable(target.id, playheadTime) : null
  const displayPadding = evaluated?.padding ?? cell.padding ?? 0
  const displayBorderRadius = evaluated?.borderRadius ?? cell.borderRadius ?? 0

  const isAnimated = (prop: TableAnimationProperty) => engine.hasTableTrack(target.id, prop)

  const commitCellField = (property: TableAnimationProperty, value: number) => {
    if (animationMode && slideId) {
      const time = usePlaybackController.getState().getTime(slideId)
      const existing = engine.getTableKeyframes(target.id, property).find((kf) => kf.time === time)
      try {
        if (existing) {
          const result = dispatch(
            new SetKeyframeValueCommand({
              target: { kind: 'table', nodeId: target.id, property },
              keyframeId: existing.id,
              newValue: value,
            }),
          )
          if (!result.ok) throw result.error
          return
        }
        const result = dispatch(
          new AddKeyframeCommand({
            target: { kind: 'table', nodeId: target.id, property },
            time,
            value,
          }),
        )
        if (!result.ok) throw result.error
        return
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error))
        return
      }
    }
    runCommand(notify, () => {
      return dispatch(
        new SetTableCellComponentCommand({
          nodeId: target.id,
          tableCell: { ...cell, [property]: value } as typeof cell,
        }),
      )
    })
  }

  const commitColSpan = (raw: string) => {
    const value = Number(raw)
    if (Number.isFinite(value) && value >= 1) {
      runCommand(notify, () => {
        return dispatch(
          new SetTableCellComponentCommand({
            nodeId: target.id,
            tableCell: { ...cell, colSpan: Math.floor(value) },
          }),
        )
      })
    }
  }

  const commitRowSpan = (raw: string) => {
    const value = Number(raw)
    if (Number.isFinite(value) && value >= 1) {
      runCommand(notify, () => {
        return dispatch(
          new SetTableCellComponentCommand({
            nodeId: target.id,
            tableCell: { ...cell, rowSpan: Math.floor(value) },
          }),
        )
      })
    }
  }

  const commitPadding = (raw: string) => {
    const value = Number(raw)
    if (Number.isFinite(value) && value >= 0) {
      commitCellField('padding', value)
    }
  }

  const commitBorderColor = (event: React.ChangeEvent<HTMLInputElement>) => {
    runCommand(notify, () => {
      return dispatch(
        new SetTableCellComponentCommand({
          nodeId: target.id,
          tableCell: { ...cell, borderColor: event.target.value },
        }),
      )
    })
  }

  const commitBackground = (event: React.ChangeEvent<HTMLInputElement>) => {
    runCommand(notify, () => {
      return dispatch(
        new SetTableCellComponentCommand({
          nodeId: target.id,
          tableCell: { ...cell, background: event.target.value },
        }),
      )
    })
  }

  const commitZIndex = (raw: string) => {
    const value = Number(raw)
    if (Number.isFinite(value) && Number.isInteger(value)) {
      runCommand(notify, () => {
        return dispatch(
          new SetTableCellComponentCommand({
            nodeId: target.id,
            tableCell: { ...cell, zIndex: Math.floor(value) },
          }),
        )
      })
    }
  }

  const adjustZIndex = (value: number) => {
    runCommand(notify, () => {
      return dispatch(
        new SetTableCellComponentCommand({
          nodeId: target.id,
          tableCell: { ...cell, zIndex: Math.floor(value) },
        }),
      )
    })
  }

  return (
    <section className="inspector-section">
      <h3 className="inspector-section__title">Table Cell</h3>

      <NumericField
        label="Col Span"
        value={cell.colSpan}
        step={1}
        disabled={playing}
        onCommit={commitColSpan}
        onAdjust={(value) =>
          runCommand(notify, () =>
            dispatch(
              new SetTableCellComponentCommand({
                nodeId: target.id,
                tableCell: { ...cell, colSpan: Math.max(1, Math.floor(value)) },
              }),
            ),
          )
        }
      />

      <NumericField
        label="Row Span"
        value={cell.rowSpan}
        step={1}
        disabled={playing}
        onCommit={commitRowSpan}
        onAdjust={(value) =>
          runCommand(notify, () =>
            dispatch(
              new SetTableCellComponentCommand({
                nodeId: target.id,
                tableCell: { ...cell, rowSpan: Math.max(1, Math.floor(value)) },
              }),
            ),
          )
        }
      />

      <NumericField
        label="Padding"
        value={displayPadding}
        step={1}
        disabled={playing || (!animationMode && isAnimated('padding'))}
        onCommit={commitPadding}
        onAdjust={(value) => commitCellField('padding', Math.max(0, value))}
      />

      <NumericField
        label="Border Radius"
        value={displayBorderRadius}
        step={1}
        disabled={playing || (!animationMode && isAnimated('borderRadius'))}
        onCommit={(raw) => {
          const v = Number(raw)
          if (!Number.isFinite(v) || v < 0) {
            notify('Border radius must be a non-negative number')
            return
          }
          commitCellField('borderRadius', v)
        }}
        onAdjust={(value) => commitCellField('borderRadius', Math.max(0, value))}
      />

      <div className="inspector-field">
        <label className="inspector-field__label" htmlFor="cell-border-color">
          Border Color
        </label>
        <input
          id="cell-border-color"
          className="inspector-field__color"
          type="color"
          aria-label="Border Color"
          value={cell.borderColor ?? '#000000'}
          disabled={playing}
          onChange={commitBorderColor}
        />
      </div>

      <div className="inspector-field">
        <label className="inspector-field__label" htmlFor="cell-background">
          Background
        </label>
        <input
          id="cell-background"
          className="inspector-field__color"
          type="color"
          aria-label="Background"
          value={cell.background ?? '#ffffff'}
          disabled={playing}
          onChange={commitBackground}
        />
      </div>

      <NumericField
        label="Z-Index"
        value={cell.zIndex ?? 0}
        step={1}
        disabled={playing}
        onCommit={commitZIndex}
        onAdjust={adjustZIndex}
      />
    </section>
  )
}
