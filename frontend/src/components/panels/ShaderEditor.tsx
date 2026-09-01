import { useEffect, useMemo, useRef, useState } from 'react'
import { compileFragmentShader } from '../../shaders/compiler'
import { reflectUniforms } from '../../shaders/reflection'
import { highlightGlsl } from './ShaderSourceViewer'
import { realPixi } from '../../pixi/renderer/pixi'
import {
  ShaderPreviewStage,
  type ShaderPreviewUniform,
} from '../../pixi/renderer/shaderPreviewStage'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'

export interface ShaderEditorProps {
  initialSource: string
  initialName: string
  onSave: (payload: { name: string; source: string }) => Promise<void> | void
  onCancel: () => void
  existingNames?: readonly string[]
}

function toPreviewUniforms(source: string): ShaderPreviewUniform[] {
  const reflection = reflectUniforms(source)
  return reflection.uniforms.map((uniform) => ({
    key: uniform.key,
    type: uniform.type,
    value: uniform.default === null && uniform.type === 'sampler2D' ? '' : uniform.default,
  }))
}

export function ShaderEditor({
  initialSource,
  initialName,
  onSave,
  onCancel,
  existingNames,
}: ShaderEditorProps) {
  const [name, setName] = useState(initialName)
  const [source, setSource] = useState(initialSource)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const compileStatus = useMemo(() => compileFragmentShader(source), [source])
  const reflection = useMemo(() => reflectUniforms(source), [source])

  const nameExists =
    existingNames !== undefined &&
    existingNames.some((existing) => existing.toLowerCase() === name.trim().toLowerCase())

  const canSave =
    name.trim().length > 0 &&
    source.trim().length > 0 &&
    compileStatus.status === 'Compiled' &&
    !nameExists &&
    !saving

  const hostRef = useRef<HTMLDivElement>(null)
  const slotRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<ShaderPreviewStage | null>(null)
  const initialLast = (() => {
    try {
      const status = compileFragmentShader(initialSource)
      return status.status === 'Compiled' ? initialSource : null
    } catch {
      return null
    }
  })()
  const lastSuccessfulRef = useRef<string | null>(initialLast)
  const [lastSuccessful, setLastSuccessful] = useState<string | null>(initialLast)

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }
    const resolveAssetUrl = (definitionId: string): string | null =>
      useAssetLibraryStore.getState().definitions.find((entry) => entry.id === definitionId)
        ?.original_url ?? null
    const instance = new ShaderPreviewStage(realPixi, undefined, resolveAssetUrl)
    let disposed = false
    void instance.start(host).then(() => {
      if (!disposed) {
        setStage(instance)
      }
    })
    return () => {
      disposed = true
      instance.destroy()
    }
  }, [])

  const assets = useAssetLibraryStore((state) => state.definitions)
  useEffect(() => {
    stage?.rebindSamplers()
  }, [stage, assets])

  useEffect(() => {
    if (!stage) {
      return
    }
    const slot = slotRef.current
    if (!slot) {
      return
    }
    stage.setSlot('shader-editor-preview', slot)
    return () => {
      stage.setSlot('shader-editor-preview', null)
    }
  }, [stage])

  useEffect(() => {
    if (!stage) {
      return
    }
    if (compileStatus.status === 'Compiled') {
      const uniforms = toPreviewUniforms(source)
      stage.setCell('shader-editor-preview', { source, uniforms })
      lastSuccessfulRef.current = source
      // eslint-disable-next-line react-hooks/set-state-in-effect -- keep last successful for preview placeholder
      setLastSuccessful(source)
    } else {
      // Do not black out: keep last successful preview visible.
      // If there is no last successful, clear the preview to avoid showing black.
      if (lastSuccessfulRef.current === null) {
        stage.setCell('shader-editor-preview', null)
      }
    }
  }, [stage, source, compileStatus])

  // Keep preview synced on layout changes
  useEffect(() => {
    stage?.sync()
  }, [stage, compileStatus, reflection])

  const highlighted = useMemo(() => highlightGlsl(source), [source])

  const handleSave = async () => {
    if (!canSave) {
      return
    }
    if (nameExists) {
      setSaveError('A shader with this name already exists')
      return
    }
    setSaveError(null)
    setSaving(true)
    try {
      await onSave({ name: name.trim(), source })
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Save failed')
      setSaving(false)
      return
    }
    setSaving(false)
  }

  const compileLabel =
    compileStatus.status === 'Compiled' ? 'Compiled' : `Failed (${compileStatus.errors.length})`

  return (
    <div className="shader-editor" role="dialog" aria-label="Shader editor" aria-modal="true">
      <header className="shader-editor__header">
        <h3 className="shader-editor__title">Edit Shader as New</h3>
        <button className="shader-editor__close" aria-label="Cancel editing" onClick={onCancel}>
          Cancel
        </button>
      </header>

      <div className="shader-editor__field">
        <label className="shader-editor__label" htmlFor="shader-editor-name">
          Shader Name
        </label>
        <input
          id="shader-editor-name"
          className="shader-editor__input"
          aria-label="Shader name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New shader name"
        />
        {name.trim().length === 0 && (
          <p className="shader-editor__notice" role="alert">
            Name cannot be empty
          </p>
        )}
        {nameExists && (
          <p className="shader-editor__notice" role="alert">
            A shader with this name already exists
          </p>
        )}
      </div>

      <div className="shader-editor__preview" aria-label="Live preview">
        <h4 className="shader-editor__subtitle">Live Preview</h4>
        <div
          ref={hostRef}
          className="shader-editor__preview-host"
          style={{
            position: 'relative',
            width: '100%',
            height: '120px',
            overflow: 'hidden',
            background: '#1a1a1a',
            borderRadius: '4px',
          }}
        >
          <div
            ref={slotRef}
            className="shader-editor__preview-slot"
            style={{ position: 'absolute', inset: 0 }}
            aria-hidden="true"
          />
          {compileStatus.status === 'Failed' && lastSuccessful === null && (
            <div
              className="shader-editor__preview-placeholder"
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#888',
                fontSize: '12px',
              }}
            >
              Preview unavailable — fix compilation errors
            </div>
          )}
        </div>
        <p className="shader-editor__notice">
          {compileStatus.status === 'Compiled'
            ? 'Preview shows compiled shader with default uniforms.'
            : 'Preview keeps last successful compile — fix errors to update.'}
        </p>
      </div>

      <div className="shader-editor__field">
        <label className="shader-editor__label" htmlFor="shader-editor-source">
          GLSL Source
        </label>
        <textarea
          id="shader-editor-source"
          className="shader-editor__textarea"
          aria-label="GLSL source"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          rows={16}
          spellCheck={false}
          style={{ fontFamily: 'monospace', width: '100%', minHeight: '240px' }}
        />
      </div>

      <div className="shader-editor__highlight" aria-hidden="true">
        <h4 className="shader-editor__subtitle">Syntax Highlight Preview</h4>
        <pre className="shader-source-viewer__code">
          <code className="glsl-code" dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
      </div>

      <div className="shader-editor__status" aria-live="polite">
        <span
          className={`shader-editor__badge${
            compileStatus.status === 'Compiled'
              ? ' shader-editor__badge--compiled'
              : ' shader-editor__badge--failed'
          }`}
        >
          {compileLabel}
        </span>
        {compileStatus.status === 'Failed' && (
          <ul className="shader-editor__errors" role="alert">
            {compileStatus.errors.map((error, index) => (
              <li key={`${error.line}-${index}`}>
                {error.line > 0 ? `Line ${error.line}: ${error.message}` : error.message}
              </li>
            ))}
          </ul>
        )}
        {reflection.warnings.length > 0 && (
          <ul className="shader-editor__warnings">
            {reflection.warnings.map((warning, index) => (
              <li key={`${warning.line}-${index}`}>
                Line {warning.line}: {warning.message}
              </li>
            ))}
          </ul>
        )}
        {compileStatus.status === 'Failed' && (
          <p className="shader-editor__notice shader-editor__notice--error" role="alert">
            Fix compilation errors before saving — shaders with syntax errors cannot be saved.
          </p>
        )}
      </div>

      {reflection.uniforms.length > 0 && (
        <div className="shader-editor__uniforms">
          <h4 className="shader-editor__subtitle">Detected Uniforms</h4>
          <ul>
            {reflection.uniforms.map((uniform) => (
              <li key={uniform.key}>
                {uniform.key} : {uniform.type}
              </li>
            ))}
          </ul>
        </div>
      )}

      {saveError && (
        <p className="shader-editor__notice shader-editor__notice--error" role="alert">
          {saveError}
        </p>
      )}

      <div className="shader-editor__actions">
        <button
          className="shader-editor__save"
          aria-label="Save shader"
          disabled={!canSave}
          title={
            !canSave
              ? compileStatus.status === 'Failed'
                ? 'Cannot save — shader has compilation errors'
                : name.trim().length === 0
                  ? 'Cannot save — name is empty'
                  : source.trim().length === 0
                    ? 'Cannot save — source is empty'
                    : nameExists
                      ? 'Cannot save — name already exists'
                      : 'Cannot save'
              : undefined
          }
          onClick={handleSave}
        >
          {saving ? 'Saving…' : 'Save as New'}
        </button>
        <button className="shader-editor__cancel" aria-label="Cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
