import type { SceneNode } from '../../engine'
import type { TableComponent, TableDimension } from '../../engine/components'
import type { DispatchCommand } from '../../engine/commands'
import {
  SetTableComponentCommand,
  AddTableRowCommand,
  RemoveTableRowCommand,
  AddTableColumnCommand,
  RemoveTableColumnCommand,
  SetTableRowComponentCommand,
  SetTableCellComponentCommand,
} from '../../engine/commands'
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
      <TableLevelInspector
        target={target}
        dispatch={dispatch}
        notify={notify}
        playing={playing}
      />
    )
  }

  if (target.components.tableRow) {
    return (
      <TableRowInspector
        target={target}
        dispatch={dispatch}
        notify={notify}
        playing={playing}
      />
    )
  }

  if (target.components.tableCell) {
    return (
      <TableCellInspector
        target={target}
        dispatch={dispatch}
        notify={notify}
        playing={playing}
      />
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
  const table = target.components.table
  if (!table) return null

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

function TableRowInspector({
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
  const row = target.components.tableRow
  if (!row) return null

  const commitBorderColor = (event: React.ChangeEvent<HTMLInputElement>) => {
    runCommand(notify, () => {
      return dispatch(
        new SetTableRowComponentCommand({
          nodeId: target.id,
          tableRow: { ...row, borderColor: event.target.value },
        }),
      )
    })
  }

  const commitBackground = (event: React.ChangeEvent<HTMLInputElement>) => {
    runCommand(notify, () => {
      return dispatch(
        new SetTableRowComponentCommand({
          nodeId: target.id,
          tableRow: { ...row, background: event.target.value },
        }),
      )
    })
  }

  return (
    <section className="inspector-section">
      <h3 className="inspector-section__title">Table Row</h3>

      <div className="inspector-field">
        <label className="inspector-field__label" htmlFor="row-border-color">
          Border Color
        </label>
        <input
          id="row-border-color"
          className="inspector-field__color"
          type="color"
          aria-label="Border Color"
          value={row.borderColor ?? '#000000'}
          disabled={playing}
          onChange={commitBorderColor}
        />
      </div>

      <div className="inspector-field">
        <label className="inspector-field__label" htmlFor="row-background">
          Background
        </label>
        <input
          id="row-background"
          className="inspector-field__color"
          type="color"
          aria-label="Background"
          value={row.background ?? '#ffffff'}
          disabled={playing}
          onChange={commitBackground}
        />
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
  const cell = target.components.tableCell
  if (!cell) return null

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
      runCommand(notify, () => {
        return dispatch(
          new SetTableCellComponentCommand({
            nodeId: target.id,
            tableCell: { ...cell, padding: value },
          }),
        )
      })
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
        value={cell.padding ?? 0}
        step={1}
        disabled={playing}
        onCommit={commitPadding}
        onAdjust={(value) =>
          runCommand(notify, () =>
            dispatch(
              new SetTableCellComponentCommand({
                nodeId: target.id,
                tableCell: { ...cell, padding: Math.max(0, value) },
              }),
            ),
          )
        }
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
    </section>
  )
}
