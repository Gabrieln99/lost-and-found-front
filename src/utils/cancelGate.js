export class CancelledError extends Error {}

/**
 * A manually-triggerable "gate" that can be raced (via Promise.race)
 * against an in-flight wallet request, so a UI waiting on that request can
 * move on immediately when the user clicks Cancel -- wallet requests
 * (MetaMask's confirmation popup included) aren't actually abortable, so
 * this doesn't stop the underlying request, it just stops the UI from
 * waiting on it.
 * @returns {{ promise: Promise<never>, cancel: () => void }}
 */
export function createCancelGate() {
  let reject
  const promise = new Promise((_, rej) => {
    reject = rej
  })
  return {
    promise,
    cancel() {
      reject(new CancelledError('Cancelled by user.'))
    },
  }
}

/**
 * Attaches a no-op catch handler to a promise that may be abandoned (e.g.
 * because the user cancelled and its result is no longer awaited by
 * anyone), so a later rejection doesn't surface as an unhandled promise
 * rejection.
 * @param {Promise<unknown>} promise
 */
export function ignoreLateSettlement(promise) {
  promise.catch(() => {})
}
