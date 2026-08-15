import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { ShaderDefinition, ShaderUniformDefault, ShaderUniformInput } from '../../api'
import type { MaterialParameterDefaultValue } from '../../engine/materialResolution'
import { uniqueNodeName } from '../../engine/naming'
import { realPixi } from '../../pixi/renderer/pixi'
import type {
  ShaderPreviewSource,
  ShaderPreviewUniform,
} from '../../pixi/renderer/shaderPreviewStage'
import { ShaderPreviewStage } from '../../pixi/renderer/shaderPreviewStage'
import type { ShaderCompileStatus } from '../../shaders/compiler'
import type { ReflectedUniformDefault, ShaderReflection } from '../../shaders/reflection'
import { useShaderLibraryStore } from '../../stores/shaderLibraryStore'
import { UniformParameterField } from './uniformControls'

function compileBadgeLabel(status: ShaderCompileStatus | undefined): string {
  if (!status) {
    return 'Not compiled'
  }
  return status.status === 'Compiled' ? 'Compiled' : `Failed (${status.errors.length})`
}

function uniqueShaderName(base: string, existing: readonly ShaderDefinition[]): string {
  return uniqueNodeName(new Set(existing.map((definition) => definition.name)), base)
}

function displayUniforms(
  definition: ShaderDefinition,
  reflection: ShaderReflection | undefined,
): ShaderUniformInput[] {
  const defaults = definition.default_uniforms.map((uniform) => ({
    key: String(uniform.key),
    kind: String(uniform.kind),
    default: uniform.default as ShaderUniformDefault,
  }))
  if (defaults.length > 0) {
    return defaults
  }
  return (reflection?.uniforms ?? []).map((uniform) => ({
    key: uniform.key,
    kind: uniform.type,
    default: uniform.default,
  }))
}

function previewUniforms(
  definition: ShaderDefinition,
  reflection: ShaderReflection | undefined,
): ShaderPreviewUniform[] {
  return displayUniforms(definition, reflection)
    .filter((uniform) => uniform.kind !== 'sampler2D')
    .map((uniform) => ({
      key: uniform.key,
      type: uniform.kind,
      value: uniform.default,
    }))
}

function previewSourceOf(
  definition: ShaderDefinition,
  status: ShaderCompileStatus | undefined,
  reflection: ShaderReflection | undefined,
): ShaderPreviewSource | null {
  if (status?.status !== 'Compiled') {
    return null
  }
  return { source: definition.source, uniforms: previewUniforms(definition, reflection) }
}

function formatUniformDefault(value: ShaderUniformDefault | ReflectedUniformDefault): string {
  if (value === null || value === undefined) {
    return '—'
  }
  if (Array.isArray(value)) {
    return value.join(', ')
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  return String(value)
}

function formatDate(date: string): string {
  return date.slice(0, 10)
}

function uniformErrorLabel(error: { line: number; message: string }): string {
  return error.line > 0 ? `Line ${error.line}: ${error.message}` : error.message
}

interface ShaderCellProps {
  definition: ShaderDefinition
  status: ShaderCompileStatus | undefined
  reflection: ShaderReflection | undefined
  stage: ShaderPreviewStage | null
  editing: boolean
  onSelect: (shaderId: string) => void
  onBeginRename: () => void
  onCommitRename: (name: string) => void
  onCancelRename: () => void
  onDuplicate: () => void
  onDelete: () => void
}

function ShaderCell({
  definition,
  status,
  reflection,
  stage,
  editing,
  onSelect,
  onBeginRename,
  onCommitRename,
  onCancelRename,
  onDuplicate,
  onDelete,
}: ShaderCellProps) {
  const slotRef = useRef<HTMLDivElement>(null)
  const preview = useMemo(
    () => previewSourceOf(definition, status, reflection),
    [definition, status, reflection],
  )

  useEffect(() => {
    if (!stage) {
      return
    }
    stage.setSlot(definition.id, slotRef.current)
    stage.setCell(definition.id, preview)
    return () => {
      stage.setCell(definition.id, null)
      stage.setSlot(definition.id, null)
    }
  }, [stage, definition.id, preview])

  return (
    <li key={definition.id} className="shader-grid__item">
      {editing ? (
        <input
          className="shader-cell__rename"
          aria-label="Shader name"
          defaultValue={definition.name}
          autoFocus
          onFocus={(event) => event.target.select()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              onCommitRename(event.currentTarget.value)
            } else if (event.key === 'Escape') {
              onCancelRename()
            }
          }}
          onBlur={(event) => {
            if (editing) {
              onCommitRename(event.target.value)
            }
          }}
        />
      ) : (
        <button
          className="shader-cell"
          aria-label={`Select ${definition.name}`}
          onClick={() => onSelect(definition.id)}
        >
          <div className="shader-cell__preview" ref={slotRef} aria-hidden="true" />
          <span className="shader-cell__name">{definition.name}</span>
          <span
            className={`shader-cell__badge${
              status?.status === 'Compiled'
                ? ' shader-cell__badge--compiled'
                : status?.status === 'Failed'
                  ? ' shader-cell__badge--failed'
                  : ''
            }`}
          >
            {compileBadgeLabel(status)}
          </span>
        </button>
      )}
      {!editing && (
        <div className="shader-cell__actions">
          <button
            aria-label={`Rename ${definition.name}`}
            title={`Rename ${definition.name}`}
            onClick={onBeginRename}
          >
            Rename
          </button>
          <button
            aria-label={`Duplicate ${definition.name}`}
            title={`Duplicate ${definition.name}`}
            onClick={onDuplicate}
          >
            Duplicate
          </button>
          <button
            aria-label={`Delete ${definition.name}`}
            title={
              definition.is_builtin
                ? 'Built-in shaders cannot be deleted'
                : `Delete ${definition.name}`
            }
            disabled={definition.is_builtin}
            onClick={onDelete}
          >
            Delete
          </button>
        </div>
      )}
    </li>
  )
}

interface ShaderPreviewPanelProps {
  definition: ShaderDefinition
  status: ShaderCompileStatus | undefined
  reflection: ShaderReflection | undefined
  onClose: () => void
}

function ShaderPreviewPanel({ definition, status, reflection, onClose }: ShaderPreviewPanelProps) {
  const reuploadRef = useRef<HTMLInputElement>(null)
  const reuploadSource = useShaderLibraryStore((state) => state.reuploadSource)
  const updateUniformDefaults = useShaderLibraryStore((state) => state.updateUniformDefaults)
  const uniforms = displayUniforms(definition, reflection)
  const editableUniforms = uniforms.filter((uniform) => uniform.kind !== 'sampler2D')
  const samplerUniforms = uniforms.filter((uniform) => uniform.kind === 'sampler2D')

  const commitDefault = (key: string, value: MaterialParameterDefaultValue) => {
    // Persisted sampler defaults ride along; reflection-only samplers (default
    // null) are unpersisted and would fail backend validation.
    const next = uniforms
      .filter((uniform) => uniform.kind !== 'sampler2D' || uniform.default !== null)
      .map((uniform) => (uniform.key === key ? { ...uniform, default: value } : uniform))
    void updateUniformDefaults(definition.id, next)
  }

  const handleReupload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) {
      void reuploadSource(definition.id, file)
    }
  }

  return (
    <section className="shader-preview" aria-label="Shader preview">
      <header className="shader-preview__header">
        <h3 className="shader-preview__title">{definition.name}</h3>
        <div className="shader-preview__actions">
          <button className="shader-preview__reupload" onClick={() => reuploadRef.current?.click()}>
            Re-upload
          </button>
          <button className="shader-preview__close" onClick={onClose}>
            Close preview
          </button>
        </div>
      </header>
      <input
        ref={reuploadRef}
        type="file"
        accept=".glsl"
        aria-label="Re-upload shader file"
        hidden
        onChange={handleReupload}
      />
      <div className="shader-preview__status">
        <span
          className={`shader-preview__status-badge${
            status?.status === 'Compiled'
              ? ' shader-preview__status-badge--compiled'
              : status?.status === 'Failed'
                ? ' shader-preview__status-badge--failed'
                : ''
          }`}
        >
          {compileBadgeLabel(status)}
        </span>
        {status?.status === 'Failed' && (
          <ul className="shader-preview__errors">
            {status.errors.map((error, index) => (
              <li key={`${error.line}-${index}`}>{uniformErrorLabel(error)}</li>
            ))}
          </ul>
        )}
      </div>
      {editableUniforms.length > 0 && (
        <>
          <h4 className="shader-preview__subtitle">Uniform Defaults</h4>
          {editableUniforms.map((uniform) => (
            <UniformParameterField
              key={uniform.key}
              parameter={{
                key: uniform.key,
                kind: uniform.kind,
                default: uniform.default as MaterialParameterDefaultValue,
              }}
              effective={uniform.default as MaterialParameterDefaultValue | null}
              overridden="none"
              onChange={(value) => commitDefault(uniform.key, value)}
              onClear={() => undefined}
            />
          ))}
        </>
      )}
      {samplerUniforms.length > 0 && (
        <>
          <h4 className="shader-preview__subtitle">Sampler Textures</h4>
          <dl className="shader-preview__uniforms">
            {samplerUniforms.map((uniform) => (
              <div key={uniform.key} className="shader-preview__uniform">
                <dt>{uniform.key}</dt>
                <dd>{uniform.kind}</dd>
                <dd>{formatUniformDefault(uniform.default)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      <h4 className="shader-preview__subtitle">Metadata</h4>
      <dl className="shader-preview__metadata">
        <div className="shader-preview__field">
          <dt>Description</dt>
          <dd>{definition.description || '—'}</dd>
        </div>
        <div className="shader-preview__field">
          <dt>Tags</dt>
          <dd>{definition.tags.length > 0 ? definition.tags.join(', ') : '—'}</dd>
        </div>
        <div className="shader-preview__field">
          <dt>Imported</dt>
          <dd>{formatDate(definition.created_at)}</dd>
        </div>
        <div className="shader-preview__field">
          <dt>Updated</dt>
          <dd>{formatDate(definition.updated_at)}</dd>
        </div>
        <div className="shader-preview__field">
          <dt>Origin</dt>
          <dd>{definition.is_builtin ? 'Built-in' : 'Imported'}</dd>
        </div>
      </dl>
    </section>
  )
}

export function ShadersPanel() {
  const definitions = useShaderLibraryStore((state) => state.definitions)
  const compileStatus = useShaderLibraryStore((state) => state.compileStatus)
  const reflections = useShaderLibraryStore((state) => state.reflections)
  const loading = useShaderLibraryStore((state) => state.loading)
  const unavailable = useShaderLibraryStore((state) => state.unavailable)
  const selectedId = useShaderLibraryStore((state) => state.selectedId)
  const loadLibrary = useShaderLibraryStore((state) => state.loadLibrary)
  const selectShader = useShaderLibraryStore((state) => state.selectShader)

  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [stage, setStage] = useState<ShaderPreviewStage | null>(null)
  const stageHostRef = useRef<HTMLDivElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const importShader = useShaderLibraryStore((state) => state.importShader)
  const renameShader = useShaderLibraryStore((state) => state.renameShader)
  const duplicateShader = useShaderLibraryStore((state) => state.duplicateShader)
  const deleteShader = useShaderLibraryStore((state) => state.deleteShader)

  useEffect(() => {
    void loadLibrary()
  }, [loadLibrary])

  useEffect(() => {
    const host = stageHostRef.current
    if (!host) {
      return
    }
    const instance = new ShaderPreviewStage(realPixi)
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

  const handleImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) {
      void importShader(file)
    }
  }

  const commitRename = (shaderId: string, name: string) => {
    setEditingId(null)
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      return
    }
    void renameShader(shaderId, trimmed)
  }

  const filtered = definitions.filter((definition) =>
    definition.name.toLowerCase().includes(search.trim().toLowerCase()),
  )
  const selected = definitions.find((definition) => definition.id === selectedId)

  return (
    <div className="shaders-panel">
      <div className="shaders-toolbar">
        <div className="shaders-toolbar__row">
          <button
            className="shaders-toolbar__import"
            disabled={unavailable}
            onClick={() => importInputRef.current?.click()}
          >
            Import Shader
          </button>
        </div>
        <div className="shaders-toolbar__row">
          <input
            className="shaders-toolbar__search"
            type="search"
            aria-label="Search shaders"
            placeholder="Search by name"
            value={search}
            disabled={unavailable}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      <input
        ref={importInputRef}
        type="file"
        accept=".glsl"
        aria-label="Import shader file"
        hidden
        onChange={handleImport}
      />
      <div className="shader-preview-host" ref={stageHostRef}>
        {unavailable ? (
          <div className="panel-status panel-status--unavailable">
            <p>Shader library unavailable — start the backend</p>
          </div>
        ) : loading && definitions.length === 0 ? (
          <div className="panel-status">
            <p>Loading library…</p>
          </div>
        ) : definitions.length === 0 ? (
          <div className="panel-empty-state">
            <p>No shaders imported. Import a .glsl fragment shader to get started.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="panel-empty-state">
            <p>No shaders match your search.</p>
          </div>
        ) : (
          <ul className="shader-grid">
            {filtered.map((definition) => (
              <ShaderCell
                key={definition.id}
                definition={definition}
                status={compileStatus[definition.id]}
                reflection={reflections[definition.id]}
                stage={stage}
                editing={editingId === definition.id}
                onSelect={selectShader}
                onBeginRename={() => setEditingId(definition.id)}
                onCommitRename={(name) => commitRename(definition.id, name)}
                onCancelRename={() => setEditingId(null)}
                onDuplicate={() =>
                  void duplicateShader(
                    definition.id,
                    uniqueShaderName(definition.name, definitions),
                  )
                }
                onDelete={() => void deleteShader(definition.id)}
              />
            ))}
          </ul>
        )}
      </div>
      {selected && (
        <ShaderPreviewPanel
          definition={selected}
          status={compileStatus[selected.id]}
          reflection={reflections[selected.id]}
          onClose={() => selectShader(null)}
        />
      )}
    </div>
  )
}
