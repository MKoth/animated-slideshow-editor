import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExportSettingsDialog } from '../components/settings/ExportSettingsDialog'
import { DEFAULT_CAMERA_FRAME_SIZE } from '../engine/cameraFrameSize'
import { useUiStore } from '../stores/uiStore'

describe('video export settings', () => {
  beforeEach(() => {
    useUiStore.getState().setCameraFrameSize(DEFAULT_CAMERA_FRAME_SIZE)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ exportRoot: '/local/exports', defaultExportRoot: '/local/exports' }),
      }),
    )
  })

  afterEach(() => {
    useUiStore.getState().setCameraFrameSize(DEFAULT_CAMERA_FRAME_SIZE)
    vi.unstubAllGlobals()
  })

  it('offers standard pixel sizes as radios and persists the selected global frame size', async () => {
    render(<ExportSettingsDialog onClose={() => {}} />)
    const portrait = await screen.findByRole('radio', { name: /1080 × 1920 px/ })
    expect(screen.getByRole('radio', { name: /1920 × 1080 px.*16:9/ })).toBeChecked()

    await userEvent.click(portrait)

    expect(portrait).toBeChecked()
    expect(portrait).toHaveAccessibleName(/9:16/)
    expect(useUiStore.getState().cameraFrameSize).toBe('1080x1920')
  })
})
