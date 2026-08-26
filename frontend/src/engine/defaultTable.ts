import type { TableComponent } from './components'

export function defaultTableComponent(): TableComponent {
  return {
    kind: 'table',
    columns: [{ width: 100 }, { width: 100 }],
    rows: [{ width: 30 }, { width: 30 }],
    gap: 4,
    cellPadding: 8,
    borderWidth: 1,
    borderColor: '#000000',
    textWrap: 'wrap',
    columnMapping: { 0: 'Column A', 1: 'Column B' },
    cellSpans: {},
  }
}
