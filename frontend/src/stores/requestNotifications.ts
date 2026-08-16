import { ApiError } from '../api/apiClient'
import { useNotificationStore } from './notificationStore'

/** Notify about a failed library request, keeping the generic message unless
 * the backend returned a detail we can surface to the user. */
export function notifyRequestFailure(
  failedMessage: string,
  backendDownMessage: string,
  error: unknown,
  markUnavailable: () => void,
): void {
  if (error instanceof ApiError) {
    const detail = error.detail
    useNotificationStore.getState().notify(detail ? `${failedMessage} ${detail}` : failedMessage)
  } else {
    useNotificationStore.getState().notify(backendDownMessage)
    markUnavailable()
  }
}
