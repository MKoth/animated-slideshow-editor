import type { SceneNode } from '../../engine'
import type { TableComponent, TableDimension } from '../../engine/components'
import type { DispatchCommand } from '../../engine/commands'
import { SetTableComponentCommand } from '../../engine/commands'
import { NumericField } from './inspectorFields'
import { runCommand } from './sectionHelpers'

function mergeTable(node: SceneNode, patch: Partial<TableComponent>): TableComponent {
  const t = node.components.table!
  return { ...t, ...patch }
}

function commitDimensionWidths(
  node: SceneNode,
  key: 'columns' | 'rows',
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

  const commitCellPadding = (raw: string) => {
    const value = Number(raw)
    if (Number.isFinite(value) && value >= 0) {
      apply({ cellPadding: value })
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

  const commitTextWrap = (event: React.ChangeEvent<HTMLSelectElement>) => {
    apply({ textWrap: event.target.value as 'wrap' | 'truncate' })
  }

  const commitColumnWidth = (index: number, raw: string) => {
    apply(commitDimensionWidths(target, 'columns', index, raw))
  }

  const commitRowWidth = (index: number, raw: string) => {
    apply(commitDimensionWidths(target, 'rows', index, raw))
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
          onAdjust={(value) => apply({ columns: table.columns.map((c, ci) => (ci === i ? { ...c, width: value } : c)) })}
        />
      ))}

      {table.rows.map((row, i) => (
        <NumericField
          key={`row-${i}`}
          label={`Row ${i + 1} Height`}
          value={typeof row.width === 'number' ? row.width : null}
          step={1}
          disabled={playing || row.width === 'auto'}
          onCommit={(raw) => commitRowWidth(i, raw)}
          onAdjust={(value) => apply({ rows: table.rows.map((r, ri) => (ri === i ? { ...r, width: value } : r)) })}
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
        label="Cell Padding"
        value={table.cellPadding}
        step={1}
        disabled={playing}
        onCommit={commitCellPadding}
        onAdjust={(value) => apply({ cellPadding: value })}
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

      <div className="inspector-field">
        <label className="inspector-field__label" htmlFor="table-text-wrap">
          Text Wrap
        </label>
        <select
          id="table-text-wrap"
          className="inspector-field__input inspector-field__select"
          aria-label="Text Wrap"
          disabled={playing}
          value={table.textWrap}
          onChange={commitTextWrap}
        >
          <option value="wrap">Wrap</option>
          <option value="truncate">Truncate</option>
        </select>
      </div>
    </section>
  )
}
