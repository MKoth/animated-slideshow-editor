import { useMissingAssetsStore } from '../../stores/missingAssetsStore'

export function MissingAssetsDialog() {
  const report = useMissingAssetsStore((state) => state.report)
  const visible = useMissingAssetsStore((state) => state.dialogVisible)
  const dismissDialog = useMissingAssetsStore((state) => state.dismissDialog)

  if (!report || !visible) {
    return null
  }

  return (
    <div className="missing-assets-dialog" role="dialog" aria-label="Missing assets">
      <p className="missing-assets-dialog__message">
        {`Missing Assets: ${report.names.join(', ')}`}
      </p>
      <p className="missing-assets-dialog__hint">
        The affected objects appear as placeholders on the canvas and are marked in the scene tree.
      </p>
      <div className="missing-assets-dialog__actions">
        <button className="missing-assets-dialog__button" onClick={dismissDialog}>
          Continue
        </button>
      </div>
    </div>
  )
}
