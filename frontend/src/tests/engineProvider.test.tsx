import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { EngineProvider } from '../app/EngineProvider'
import { useEngine, useEngineEvent } from '../app/useEngine'
import { CreateProjectCommand } from '../engine/commands'

function Probe() {
  const { engine, dispatch } = useEngine()
  const [, setTick] = useState(0)
  useEngineEvent(() => setTick((tick) => tick + 1))
  return (
    <div>
      <span data-testid="project-name">{engine.project?.name ?? 'none'}</span>
      <button onClick={() => dispatch(new CreateProjectCommand({ name: 'From UI' }))}>
        Create
      </button>
    </div>
  )
}

describe('EngineProvider', () => {
  it('provides the read API and dispatches commands to components', async () => {
    const user = userEvent.setup()
    render(
      <EngineProvider>
        <Probe />
      </EngineProvider>,
    )

    expect(screen.getByTestId('project-name')).toHaveTextContent('none')

    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(screen.getByTestId('project-name')).toHaveTextContent('From UI')
  })

  it('throws when used outside an EngineProvider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => render(<Probe />)).toThrow(/EngineProvider/)
  })

  it('does not expose engine write methods on the context', () => {
    function AssertWritesHidden() {
      const { engine } = useEngine()
      // @ts-expect-error the write API must not be reachable through the provider
      void engine.createProject
      return null
    }

    render(
      <EngineProvider>
        <AssertWritesHidden />
      </EngineProvider>,
    )
  })
})
