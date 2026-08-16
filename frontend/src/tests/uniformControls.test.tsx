import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { MaterialParameterDefault } from '../engine/materialResolution'
import { UniformParameterField } from '../components/panels/uniformControls'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'

function seedAssets(ids: string[]): void {
  useAssetLibraryStore.setState({
    definitions: ids.map((id) => ({
      id,
      name: id.replace('asset-', ''),
      description: '',
      category: 'Uncategorized',
      tags: [],
      ai_description: '',
      original_filename: '',
      import_date: '',
      width: 1,
      height: 1,
      file_size: 1,
      aspect_ratio: 1,
      default_scale: 1,
      default_rotation: 0,
      pivot: { x: 0.5, y: 0.5 },
      anchors: [],
      original_url: '',
      thumbnail_url: '',
    })),
  })
}

function renderField(
  parameter: MaterialParameterDefault,
  props: Partial<Parameters<typeof UniformParameterField>[0]> = {},
) {
  const onChange = props.onChange ?? (() => undefined)
  return render(
    <UniformParameterField
      parameter={parameter}
      effective={props.effective ?? parameter.default}
      overridden={props.overridden ?? 'none'}
      disabled={props.disabled ?? false}
      onChange={onChange}
      onClear={props.onClear ?? (() => undefined)}
    />,
  )
}

beforeEach(() => {
  useAssetLibraryStore.setState({
    definitions: [],
    loaded: false,
    loading: false,
    error: null,
    unavailable: false,
    search: '',
    sort: 'import_date',
    order: 'desc',
    selectedId: null,
  })
})

describe('uniform control generation per type', () => {
  it('renders a numeric input for a float, with a slider when the default lies in [0,1]', () => {
    const { rerender } = render(
      <UniformParameterField
        parameter={{ key: 'uIntensity', kind: 'float', default: 0.5 }}
        effective={0.5}
        overridden="none"
        onChange={() => undefined}
        onClear={() => undefined}
      />,
    )
    expect(screen.getByRole('spinbutton', { name: 'uIntensity' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'uIntensity slider' })).toBeInTheDocument()

    rerender(
      <UniformParameterField
        parameter={{ key: 'uSpread', kind: 'float', default: 4 }}
        effective={4}
        overridden="none"
        onChange={() => undefined}
        onClear={() => undefined}
      />,
    )
    expect(screen.getByRole('spinbutton', { name: 'uSpread' })).toBeInTheDocument()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })

  it('renders an integer input for an int uniform without a slider, even for a default in [0,1]', () => {
    render(
      <UniformParameterField
        parameter={{ key: 'uRepeatCount', kind: 'int', default: 0 }}
        effective={0}
        overridden="none"
        onChange={() => undefined}
        onClear={() => undefined}
      />,
    )
    expect(screen.getByRole('spinbutton', { name: 'uRepeatCount' })).toBeInTheDocument()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })

  it('rounds int commits to whole numbers', () => {
    const onChange = (value: unknown) => {
      expect(value).toBe(3)
    }
    render(
      <UniformParameterField
        parameter={{ key: 'uSteps', kind: 'int', default: 2 }}
        effective={2}
        overridden="none"
        onChange={onChange}
        onClear={() => undefined}
      />,
    )
    fireEvent.change(screen.getByRole('spinbutton', { name: 'uSteps' }), {
      target: { value: '3.4' },
    })
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'uSteps' }), { key: 'Enter' })
  })

  it('renders a checkbox for a bool uniform', () => {
    render(
      <UniformParameterField
        parameter={{ key: 'uEnabled', kind: 'bool', default: false }}
        effective={false}
        overridden="none"
        onChange={() => undefined}
        onClear={() => undefined}
      />,
    )
    const checkbox = screen.getByRole('checkbox', { name: 'uEnabled' }) as HTMLInputElement
    expect(checkbox.checked).toBe(false)
  })

  it('renders one numeric input per component for a vec uniform', () => {
    render(
      <UniformParameterField
        parameter={{ key: 'uOffset', kind: 'vec2', default: [0.1, 0.2] }}
        effective={[0.1, 0.2]}
        overridden="none"
        onChange={() => undefined}
        onClear={() => undefined}
      />,
    )
    expect(screen.getByRole('spinbutton', { name: 'uOffset.x' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'uOffset.y' })).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: 'uOffset.z' })).not.toBeInTheDocument()
  })

  it('renders a color picker for a color-named vec3 and a picker with alpha for vec4', () => {
    const { rerender } = render(
      <UniformParameterField
        parameter={{ key: 'uTintColor', kind: 'vec3', default: [1, 0, 0] }}
        effective={[1, 0, 0]}
        overridden="none"
        onChange={() => undefined}
        onClear={() => undefined}
      />,
    )
    const color = screen.getByLabelText('uTintColor') as HTMLInputElement
    expect(color.type).toBe('color')
    expect(color.value).toBe('#ff0000')
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()

    rerender(
      <UniformParameterField
        parameter={{ key: 'uFadeColor', kind: 'vec4', default: [0, 0.5, 1, 0.5] }}
        effective={[0, 0.5, 1, 0.5]}
        overridden="none"
        onChange={() => undefined}
        onClear={() => undefined}
      />,
    )
    expect((screen.getByLabelText('uFadeColor') as HTMLInputElement).value).toBe('#0080ff')
    expect(screen.getByRole('spinbutton', { name: 'uFadeColor alpha' })).toBeInTheDocument()
  })

  it('keeps per-component inputs for a non-color vec', () => {
    render(
      <UniformParameterField
        parameter={{ key: 'uOffset', kind: 'vec3', default: [0, 0, 0] }}
        effective={[0, 0, 0]}
        overridden="none"
        onChange={() => undefined}
        onClear={() => undefined}
      />,
    )
    expect(screen.queryByLabelText('uOffset') as HTMLInputElement | null).toBeNull()
    expect(screen.getByRole('spinbutton', { name: 'uOffset.x' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'uOffset.z' })).toBeInTheDocument()
  })

  it('renders an asset picker over the library for a sampler2D uniform', () => {
    seedAssets(['asset-noise', 'asset-lines'])
    render(
      <UniformParameterField
        parameter={{ key: 'uSampler', kind: 'sampler2D', default: '' }}
        effective={''}
        overridden="none"
        onChange={() => undefined}
        onClear={() => undefined}
      />,
    )
    const picker = screen.getByRole('combobox', { name: 'uSampler' }) as HTMLSelectElement
    expect([...picker.options].map((option) => option.value)).toEqual([
      '',
      'asset-noise',
      'asset-lines',
    ])
    expect(picker.value).toBe('')
  })

  it('shows the override indicator and clear action when overridden', () => {
    render(
      <UniformParameterField
        parameter={{ key: 'uIntensity', kind: 'float', default: 0.5 }}
        effective={0.9}
        overridden="all"
        onChange={() => undefined}
        onClear={() => undefined}
      />,
    )
    expect(screen.getByTitle('Override set')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear uIntensity override' })).toBeInTheDocument()
  })

  it('renders no indicator when nothing is overridden', () => {
    render(
      <UniformParameterField
        parameter={{ key: 'uIntensity', kind: 'float', default: 0.5 }}
        effective={0.5}
        overridden="none"
        onChange={() => undefined}
        onClear={() => undefined}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Clear uIntensity override' })).toBeNull()
  })
})

describe('uniform control commits', () => {
  it('commits a float edit as a number', () => {
    const onChange = (value: unknown) => {
      expect(value).toBe(0.9)
    }
    renderField({ key: 'uIntensity', kind: 'float', default: 0.5 }, { onChange })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'uIntensity' }), {
      target: { value: '0.9' },
    })
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'uIntensity' }), { key: 'Enter' })
  })

  it('commits a slider drag as a number', () => {
    const onChange = (value: unknown) => {
      expect(value).toBe(0.75)
    }
    renderField({ key: 'uIntensity', kind: 'float', default: 0.5 }, { onChange })
    fireEvent.change(screen.getByRole('slider', { name: 'uIntensity slider' }), {
      target: { value: '0.75' },
    })
  })

  it('commits a checkbox toggle as a boolean', () => {
    const onChange = (value: unknown) => {
      expect(value).toBe(true)
    }
    renderField({ key: 'uEnabled', kind: 'bool', default: false }, { onChange })
    fireEvent.click(screen.getByRole('checkbox', { name: 'uEnabled' }))
  })

  it('commits a component edit as the full vector', () => {
    const onChange = (value: unknown) => {
      expect(value).toEqual([0.5, 0.2])
    }
    renderField({ key: 'uOffset', kind: 'vec2', default: [0.1, 0.2] }, { onChange })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'uOffset.x' }), {
      target: { value: '0.5' },
    })
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'uOffset.x' }), { key: 'Enter' })
  })

  it('commits a color picker change as RGB components', () => {
    const onChange = (value: unknown) => {
      expect(value).toEqual([0, 1, 0])
    }
    renderField({ key: 'uTintColor', kind: 'vec3', default: [1, 0, 0] }, { onChange })
    fireEvent.change(screen.getByLabelText('uTintColor'), { target: { value: '#00ff00' } })
  })

  it('commits an alpha edit preserving the RGB components', () => {
    const onChange = (value: unknown) => {
      expect(value).toEqual([0, 0.5, 1, 1])
    }
    renderField({ key: 'uFadeColor', kind: 'vec4', default: [0, 0.5, 1, 0.5] }, { onChange })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'uFadeColor alpha' }), {
      target: { value: '1' },
    })
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'uFadeColor alpha' }), {
      key: 'Enter',
    })
  })

  it('commits an asset picker change as the asset id', () => {
    seedAssets(['asset-noise'])
    const onChange = (value: unknown) => {
      expect(value).toBe('asset-noise')
    }
    renderField({ key: 'uSampler', kind: 'sampler2D', default: '' }, { onChange })
    fireEvent.change(screen.getByRole('combobox', { name: 'uSampler' }), {
      target: { value: 'asset-noise' },
    })
  })

  it('ignores non-finite numeric edits', () => {
    const onChange = () => {
      throw new Error('onChange must not fire for invalid input')
    }
    renderField({ key: 'uIntensity', kind: 'float', default: 0.5 }, { onChange })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'uIntensity' }), {
      target: { value: 'abc' },
    })
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'uIntensity' }), { key: 'Enter' })
  })
})
