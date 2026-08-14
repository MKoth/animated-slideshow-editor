import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { MissingAssetsDialog } from '../components/missingAssets/MissingAssetsDialog'
import type { MissingAssetsReport } from '../engine'
import { useMissingAssetsStore } from '../stores/missingAssetsStore'

function reportWith(names: readonly string[]): MissingAssetsReport {
  return {
    missing: [{ assetDefinitionId: 'def-1', nodeIds: ['node-1'] }],
    affectedNodeIds: ['node-1'],
    names: [...names],
  }
}

beforeEach(() => {
  useMissingAssetsStore.setState({ report: null, dialogVisible: false })
})

describe('MissingAssetsDialog', () => {
  it('renders nothing when there is no report', () => {
    render(<MissingAssetsDialog />)

    expect(screen.queryByRole('dialog', { name: 'Missing assets' })).not.toBeInTheDocument()
  })

  it('renders nothing when a report exists but the dialog was dismissed', () => {
    useMissingAssetsStore.setState({ report: reportWith(['Boy']), dialogVisible: false })

    render(<MissingAssetsDialog />)

    expect(screen.queryByRole('dialog', { name: 'Missing assets' })).not.toBeInTheDocument()
  })

  it('lists the missing asset names in a friendly message', () => {
    useMissingAssetsStore.setState({
      report: reportWith(['Clock.png', 'Boy.png']),
      dialogVisible: true,
    })

    render(<MissingAssetsDialog />)

    expect(screen.getByText('Missing Assets: Clock.png, Boy.png')).toBeInTheDocument()
  })

  it('dismisses the dialog on Continue while keeping the report as the marking source', () => {
    useMissingAssetsStore.setState({ report: reportWith(['Boy']), dialogVisible: true })

    render(<MissingAssetsDialog />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(useMissingAssetsStore.getState().dialogVisible).toBe(false)
    expect(useMissingAssetsStore.getState().report?.names).toEqual(['Boy'])
    expect(screen.queryByRole('dialog', { name: 'Missing assets' })).not.toBeInTheDocument()
  })
})
