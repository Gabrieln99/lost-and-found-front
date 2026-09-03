import LostAndFoundAbi from '@/abi/LostAndFound.json'

// Copied from lost-and-found-back's compiled artifact
// (artifacts/contracts/LostAndFound.sol/LostAndFound.json). Re-copy the
// "abi" field here whenever the contract's public interface changes.
export const CONTRACT_ABI = LostAndFoundAbi

// Empty until the contract is deployed to Sepolia (see CLAUDE.md: no
// deploy pipeline exists yet). Wallet-connect works without this; any
// future contract read/write must check isContractConfigured first.
export const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || ''

export const isContractConfigured = Boolean(CONTRACT_ADDRESS)

export const SEPOLIA_CHAIN_ID = 11155111n
export const SEPOLIA_CHAIN_ID_HEX = '0xaa36a7'

export const SEPOLIA_NETWORK_PARAMS = {
  chainId: SEPOLIA_CHAIN_ID_HEX,
  chainName: 'Sepolia',
  nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://rpc.sepolia.org'],
  blockExplorerUrls: ['https://sepolia.etherscan.io'],
}
