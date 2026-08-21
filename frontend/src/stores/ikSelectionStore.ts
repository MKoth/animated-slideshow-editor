import { create } from 'zustand'

export interface IKSelectionState {
  readonly selectedChainId: string | null
  selectChain(chainId: string | null): void
}

export const useIKSelectionStore = create<IKSelectionState>()((set) => ({
  selectedChainId: null,
  selectChain: (chainId) => set({ selectedChainId: chainId }),
}))
