import { useMemo, useState } from 'react'
import { useEngine } from '../../app/useEngine'
import { snapshotCollectionContent } from '../../app/collectionContentRemoval'
import type { RemoveCollectionContentSelection } from '../../app/collectionContentRemoval'
import { formatSec, parseSec, validateSegmentRange } from '../../engine/timeSegmentExtraction'

interface Props {
  readonly collectionId: string
  readonly onClose: () => void
  readonly onConfirm: (selection: RemoveCollectionContentSelection) => void
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  marginTop: 4,
  padding: '5px 7px',
  borderRadius: 4,
  border: '1px solid var(--color-border, #ddd)',
  background: 'var(--color-bg, #fff)',
  color: 'var(--color-text, #1c1e21)',
  fontSize: 12,
  boxSizing: 'border-box',
}

export function RemoveCollectionContentModal({ collectionId, onClose, onConfirm }: Props) {
  const { engine } = useEngine()
  const snapshot = useMemo(() => {
    try {
      return snapshotCollectionContent(engine, collectionId)
    } catch {
      return null
    }
  }, [engine, collectionId])
  const [fromText, setFromText] = useState(() => formatSec(0))
  const [toText, setToText] = useState(() => formatSec(snapshot?.duration ?? 0))
  const [members, setMembers] = useState<ReadonlySet<string>>(() => new Set())
  const [tracks, setTracks] = useState<ReadonlyMap<string, ReadonlySet<string>>>(() => new Map())
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())

  const from = parseSec(fromText)
  const to = parseSec(toText)
  const rangeError =
    from === null || to === null
      ? 'Enter numeric From and To times.'
      : validateSegmentRange(from, to, snapshot?.duration ?? 0)
  const validRange = rangeError === null && from !== null && to !== null
  let keyframeCount = 0
  if (snapshot && validRange && from !== null && to !== null) {
    for (const member of snapshot.members) {
      if (members.has(member.semanticName)) continue
      const selected = tracks.get(member.semanticName) ?? new Set<string>()
      for (const track of member.tracks) {
        if (!selected.has(track.key)) continue
        keyframeCount += track.keyframes.filter((keyframe) => {
          const seconds = keyframe.time * member.duration
          return seconds >= from && seconds <= to
        }).length
      }
    }
  }
  const selectedMemberCount = members.size
  const hasSelection = selectedMemberCount > 0 || [...tracks.values()].some((set) => set.size > 0)

  const toggleMember = (semanticName: string) => {
    setMembers((previous) => {
      const next = new Set(previous)
      if (next.has(semanticName)) next.delete(semanticName)
      else next.add(semanticName)
      return next
    })
  }
  const toggleTrack = (semanticName: string, key: string) => {
    setTracks((previous) => {
      const next = new Map(previous)
      const selected = new Set(next.get(semanticName) ?? [])
      if (selected.has(key)) selected.delete(key)
      else selected.add(key)
      if (selected.size === 0) next.delete(semanticName)
      else next.set(semanticName, selected)
      return next
    })
  }
  const toggleExpanded = (semanticName: string) => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(semanticName)) next.delete(semanticName)
      else next.add(semanticName)
      return next
    })
  }

  const submit = () => {
    if (!snapshot || !validRange || from === null || to === null || !hasSelection) return
    onConfirm({
      collectionId,
      memberNames: members,
      trackKeysBySemantic: tracks,
      from,
      to,
    })
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Remove keyframes from collection"
      data-testid="remove-collection-content-modal"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1110,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--color-bg, #fff)',
          borderRadius: 8,
          padding: 16,
          width: 'min(560px, calc(100vw - 32px))',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid var(--color-border, #ddd)',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>Remove animation from collection</h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted, #666)', margin: '0 0 12px' }}>
          Remove selected semantic names from this collection, or delete selected properties’
          keyframes in the time range. Times are clip-local seconds; alignment offsets are ignored.
          Scene objects are not deleted. Changes to shared clips affect every collection that uses
          them.
        </p>
        {!snapshot ? (
          <p data-testid="remove-collection-content-missing">Collection not found.</p>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <label style={{ flex: 1, fontSize: 12 }}>
                From (s)
                <input
                  data-testid="remove-collection-from-input"
                  value={fromText}
                  onChange={(event) => setFromText(event.target.value)}
                  style={inputStyle}
                />
              </label>
              <label style={{ flex: 1, fontSize: 12 }}>
                To (s)
                <input
                  data-testid="remove-collection-to-input"
                  value={toText}
                  onChange={(event) => setToText(event.target.value)}
                  style={inputStyle}
                />
              </label>
              <button
                data-testid="remove-collection-full-range"
                onClick={() => {
                  setFromText(formatSec(0))
                  setToText(formatSec(snapshot.duration))
                }}
                style={{ ...inputStyle, width: 'auto', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                Full duration
              </button>
            </div>
            {rangeError && (
              <p
                data-testid="remove-collection-range-error"
                style={{ color: '#c00', fontSize: 12 }}
              >
                {rangeError}
              </p>
            )}
            <div
              data-testid="remove-collection-members"
              style={{
                marginTop: 10,
                overflowY: 'auto',
                border: '1px solid var(--color-border, #ddd)',
                borderRadius: 4,
                padding: 8,
                minHeight: 100,
              }}
            >
              {snapshot.members.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted, #666)' }}>
                  This collection has no semantic names.
                </p>
              ) : (
                snapshot.members.map((member) => {
                  const isExpanded = expanded.has(member.semanticName)
                  return (
                    <section key={member.semanticName} style={{ padding: '3px 0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                          type="button"
                          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${member.semanticName}`}
                          data-testid={`remove-collection-expand-${member.semanticName}`}
                          onClick={() => toggleExpanded(member.semanticName)}
                          style={{
                            border: 0,
                            background: 'transparent',
                            cursor: 'pointer',
                            width: 20,
                          }}
                        >
                          {isExpanded ? '▾' : '▸'}
                        </button>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                          <input
                            type="checkbox"
                            data-testid={`remove-collection-member-${member.semanticName}`}
                            checked={members.has(member.semanticName)}
                            onChange={() => toggleMember(member.semanticName)}
                          />
                          <span style={{ fontSize: 12, fontWeight: 600 }}>
                            {member.semanticName}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>
                            {member.clipName}
                          </span>
                        </label>
                      </div>
                      {isExpanded && (
                        <div style={{ marginLeft: 28, display: 'grid', gap: 2 }}>
                          {member.tracks.length === 0 ? (
                            <span style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>
                              No animated properties
                            </span>
                          ) : (
                            member.tracks.map((track) => (
                              <label
                                key={track.key}
                                style={{ display: 'flex', gap: 6, fontSize: 12 }}
                              >
                                <input
                                  type="checkbox"
                                  data-testid={`remove-collection-track-${member.semanticName}-${track.key}`}
                                  checked={(tracks.get(member.semanticName) ?? new Set()).has(
                                    track.key,
                                  )}
                                  onChange={() => toggleTrack(member.semanticName, track.key)}
                                />
                                <span>{track.label}</span>
                                <span style={{ color: 'var(--color-text-muted, #666)' }}>
                                  ({track.keyframes.length})
                                </span>
                              </label>
                            ))
                          )}
                        </div>
                      )}
                    </section>
                  )
                })
              )}
            </div>
            <p data-testid="remove-collection-summary" style={{ fontSize: 12, margin: '8px 0 0' }}>
              {selectedMemberCount} semantic name{selectedMemberCount === 1 ? '' : 's'} and{' '}
              {keyframeCount} keyframe{keyframeCount === 1 ? '' : 's'} selected. Submit applies all
              changes as one undo step.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button data-testid="remove-collection-cancel" onClick={onClose}>
                Cancel
              </button>
              <button
                data-testid="remove-collection-confirm"
                onClick={submit}
                disabled={
                  !validRange || !hasSelection || (selectedMemberCount === 0 && keyframeCount === 0)
                }
              >
                Remove selected
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
