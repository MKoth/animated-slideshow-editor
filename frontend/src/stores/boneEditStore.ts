import { create } from 'zustand'

export type BoneJoint = 'head' | 'tail'

export interface BoneEditState {
  readonly isEditing: boolean
  readonly selectedBoneId: string | null
  readonly selectedJoint: BoneJoint | null
  enter(boneId: string | null): void
  exit(): void
  setSelectedJoint(joint: BoneJoint | null): void
  setSelectedBoneId(boneId: string | null): void
}

export const useBoneEditStore = create<BoneEditState>()((set) => ({
  isEditing: false,
  selectedBoneId: null,
  selectedJoint: null,
  enter: (boneId) => set({ isEditing: true, selectedBoneId: boneId || null, selectedJoint: null }),
  exit: () => set({ isEditing: false, selectedBoneId: null, selectedJoint: null }),
  setSelectedJoint: (joint) => set({ selectedJoint: joint }),
  setSelectedBoneId: (boneId) => set({ selectedBoneId: boneId }),
}))
