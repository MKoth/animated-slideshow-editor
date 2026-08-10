import { useState } from 'react'
import { pingApi } from '../../api'

export function PingButton() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const handleClick = async () => {
    setBusy(true)
    try {
      const response = await pingApi.ping()
      setResult(response.message)
    } catch {
      setResult('Backend unavailable')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="ping-button">
      <button onClick={handleClick} disabled={busy}>
        Ping Backend
      </button>
      {result && <span className="ping-button__result">{result}</span>}
    </span>
  )
}
