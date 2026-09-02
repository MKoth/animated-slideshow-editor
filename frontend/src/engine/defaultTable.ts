import type { TableComponent, TableRowComponent, TableCellComponent } from './components'

export function defaultTableComponent(): TableComponent {
  return {
    kind: 'table',
    columns: [{ width: 100 }, { width: 100 }],
    gap: 0,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 0,
    padding: 0,
  }
}

export function defaultTableRowComponent(): TableRowComponent {
  return { kind: 'tableRow' }
}

export function defaultTableCellComponent(): TableCellComponent {
  return { kind: 'tableCell', colSpan: 1, rowSpan: 1, borderRadius: 0, padding: 0 }
}
