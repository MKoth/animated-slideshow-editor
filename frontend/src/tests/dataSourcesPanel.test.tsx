import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DataSourcesPanel } from '../components/panels/DataSourcesPanel'
import { useDataSourceLibraryStore } from '../stores/dataSourceLibraryStore'

const DS1_EMBEDDED = {
  id: 'ds-1',
  name: 'Sales Data',
  dataPoints: [
    { label: 'Q1', value: 100, series: 'Revenue' },
    { label: 'Q2', value: 200, series: 'Revenue' },
  ],
}

const DS2_EMBEDDED = {
  id: 'ds-2',
  name: 'Cost Data',
  dataPoints: [{ label: 'Q1', value: 50, series: 'Cost', tooltip: 'First quarter' }],
}

const mockEngine = {
  embedDataSource: vi.fn(),
  removeDataSource: vi.fn(() => true),
  embeddedDataSources: [] as readonly (
    | {
        id: string
        name: string
        dataPoints: readonly {
          label: string
          value: number
          series?: string
          tooltip?: string
          color?: string
        }[]
      }
    | {
        id: string
        name: string
        nodes: readonly { id: string; label: string }[]
        edges: readonly { from: string; to: string }[]
      }
  )[],
}

vi.mock('../app/useEngine', () => ({
  useEngine: () => ({ engine: mockEngine }),
  useEngineEvent: () => {},
}))

function renderPanel() {
  return render(<DataSourcesPanel />)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockEngine.embeddedDataSources = []
  useDataSourceLibraryStore.setState({
    definitions: [],
    selectedId: null,
  })
})

describe('DataSourcesPanel empty state', () => {
  it('shows the empty state when no data sources exist', () => {
    renderPanel()
    expect(
      screen.getByText('No data sources created. Create one to get started.'),
    ).toBeInTheDocument()
  })
})

describe('DataSourcesPanel grid', () => {
  it('renders cells for each data source with name and point count', async () => {
    mockEngine.embeddedDataSources = [DS1_EMBEDDED, DS2_EMBEDDED]
    renderPanel()

    expect(await screen.findByRole('button', { name: 'Select Sales Data' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select Cost Data' })).toBeInTheDocument()
    expect(screen.getByText('2 points')).toBeInTheDocument()
    expect(screen.getByText('1 point')).toBeInTheDocument()
  })

  it('filters data sources by search', async () => {
    mockEngine.embeddedDataSources = [DS1_EMBEDDED, DS2_EMBEDDED]
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', { name: 'Select Sales Data' })

    await user.type(screen.getByRole('searchbox', { name: 'Search data sources' }), 'sales')

    expect(screen.getByRole('button', { name: 'Select Sales Data' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Select Cost Data' })).not.toBeInTheDocument()
  })

  it('shows no-match message when search filters everything', async () => {
    mockEngine.embeddedDataSources = [DS1_EMBEDDED]
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', { name: 'Select Sales Data' })

    await user.type(screen.getByRole('searchbox', { name: 'Search data sources' }), 'zzz')

    expect(screen.getByText('No data sources match your search.')).toBeInTheDocument()
  })
})

describe('DataSourcesPanel create', () => {
  it('creates a new data source on button click', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Create Data Source' }))

    expect(mockEngine.embedDataSource).toHaveBeenCalledTimes(1)
    const definitions = useDataSourceLibraryStore.getState().definitions
    expect(definitions).toHaveLength(1)
    expect(definitions[0].name).toBe('New Data Source')
  })
})

describe('DataSourcesPanel selection', () => {
  it('selects a data source and shows the detail panel', async () => {
    mockEngine.embeddedDataSources = [DS1_EMBEDDED]
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Select Sales Data' }))

    expect(screen.getByRole('region', { name: 'Data source detail' })).toBeInTheDocument()
    expect(screen.getAllByText('Sales Data').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByLabelText('Label')[0]).toHaveValue('Q1')
    expect(screen.getAllByLabelText('Value')[0]).toHaveValue(100)
  })

  it('closes the detail panel', async () => {
    mockEngine.embeddedDataSources = [DS1_EMBEDDED]
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', { name: 'Select Sales Data' })
    await user.click(screen.getByRole('button', { name: 'Select Sales Data' }))

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('region', { name: 'Data source detail' })).not.toBeInTheDocument()
  })
})

describe('DataSourcesPanel data point editing', () => {
  it('adds a new data point', async () => {
    mockEngine.embeddedDataSources = [DS1_EMBEDDED]
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', { name: 'Select Sales Data' })
    await user.click(screen.getByRole('button', { name: 'Select Sales Data' }))

    await user.click(screen.getByRole('button', { name: 'Add Data Point' }))

    expect(mockEngine.embedDataSource).toHaveBeenCalled()
    const updated = useDataSourceLibraryStore.getState().definitions.find((d) => d.id === 'ds-1')
    expect(updated?.dataPoints).toHaveLength(3)
    expect(updated?.dataPoints[2].label).toBe('Point')
    expect(updated?.dataPoints[2].value).toBe(0)
  })

  it('removes a data point', async () => {
    mockEngine.embeddedDataSources = [DS1_EMBEDDED]
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', { name: 'Select Sales Data' })
    await user.click(screen.getByRole('button', { name: 'Select Sales Data' }))

    await user.click(screen.getByLabelText('Remove Q1'))

    expect(mockEngine.embedDataSource).toHaveBeenCalled()
    const updated = useDataSourceLibraryStore.getState().definitions.find((d) => d.id === 'ds-1')
    expect(updated?.dataPoints).toHaveLength(1)
    expect(updated?.dataPoints[0].label).toBe('Q2')
  })

  it('edits a data point label', async () => {
    mockEngine.embeddedDataSources = [DS1_EMBEDDED]
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', { name: 'Select Sales Data' })
    await user.click(screen.getByRole('button', { name: 'Select Sales Data' }))

    const labelInput = screen.getAllByLabelText('Label')[0]
    fireEvent.change(labelInput, { target: { value: 'Q3' } })

    expect(mockEngine.embedDataSource).toHaveBeenCalled()
    const updated = useDataSourceLibraryStore.getState().definitions.find((d) => d.id === 'ds-1')
    expect(updated?.dataPoints[0].label).toBe('Q3')
  })

  it('edits a data point value', async () => {
    mockEngine.embeddedDataSources = [DS1_EMBEDDED]
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', { name: 'Select Sales Data' })
    await user.click(screen.getByRole('button', { name: 'Select Sales Data' }))

    const valueInput = screen.getAllByLabelText('Value')[0]
    await user.clear(valueInput)
    await user.type(valueInput, '999')

    expect(mockEngine.embedDataSource).toHaveBeenCalled()
    const updated = useDataSourceLibraryStore.getState().definitions.find((d) => d.id === 'ds-1')
    expect(updated?.dataPoints[0].value).toBe(999)
  })

  it('edits a data point series', async () => {
    mockEngine.embeddedDataSources = [DS1_EMBEDDED]
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', { name: 'Select Sales Data' })
    await user.click(screen.getByRole('button', { name: 'Select Sales Data' }))

    const seriesInput = screen.getAllByLabelText('Series')[0]
    await user.clear(seriesInput)
    await user.type(seriesInput, 'Expenses')

    expect(mockEngine.embedDataSource).toHaveBeenCalled()
    const updated = useDataSourceLibraryStore.getState().definitions.find((d) => d.id === 'ds-1')
    expect(updated?.dataPoints[0].series).toBe('Expenses')
  })

  it('edits a data point tooltip', async () => {
    mockEngine.embeddedDataSources = [DS2_EMBEDDED]
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', { name: 'Select Cost Data' })
    await user.click(screen.getByRole('button', { name: 'Select Cost Data' }))

    const tooltipInput = screen.getByLabelText('Tooltip')
    await user.clear(tooltipInput)
    await user.type(tooltipInput, 'Second quarter')

    expect(mockEngine.embedDataSource).toHaveBeenCalled()
    const updated = useDataSourceLibraryStore.getState().definitions.find((d) => d.id === 'ds-2')
    expect(updated?.dataPoints[0].tooltip).toBe('Second quarter')
  })
})

describe('DataSourcesPanel rename and delete', () => {
  it('renames a data source from the cell', async () => {
    mockEngine.embeddedDataSources = [DS1_EMBEDDED]
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', { name: 'Select Sales Data' })

    await user.click(screen.getByRole('button', { name: 'Rename Sales Data' }))
    const input = screen.getByRole('textbox', { name: 'Data source name' })
    await user.clear(input)
    await user.type(input, 'Revenue Data{Enter}')

    expect(mockEngine.embedDataSource).toHaveBeenCalled()
    const renamed = useDataSourceLibraryStore.getState().definitions.find((d) => d.id === 'ds-1')
    expect(renamed?.name).toBe('Revenue Data')
  })

  it('deletes a data source', async () => {
    mockEngine.embeddedDataSources = [DS1_EMBEDDED, DS2_EMBEDDED]
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', { name: 'Select Cost Data' })

    await user.click(screen.getByRole('button', { name: 'Delete Sales Data' }))

    expect(mockEngine.removeDataSource).toHaveBeenCalledWith('ds-1')
    const definitions = useDataSourceLibraryStore.getState().definitions
    expect(definitions).toHaveLength(1)
    expect(definitions[0].id).toBe('ds-2')
  })

  it('duplicates a data source', async () => {
    mockEngine.embeddedDataSources = [DS1_EMBEDDED]
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('button', { name: 'Select Sales Data' })

    await user.click(screen.getByRole('button', { name: 'Duplicate Sales Data' }))

    expect(mockEngine.embedDataSource).toHaveBeenCalled()
    const definitions = useDataSourceLibraryStore.getState().definitions
    expect(definitions).toHaveLength(2)
    expect(definitions[0].name).toBe('Sales Data (2)')
    expect(definitions[0].dataPoints.map((p) => p.label)).toEqual(['Q1', 'Q2'])
  })
})
