/**
 * Truncates an Ethereum address for display, e.g. `0x1234...abcd`.
 * @param {string} address
 * @returns {string}
 */
export function shortenAddress(address) {
  if (!address) return ''
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}
