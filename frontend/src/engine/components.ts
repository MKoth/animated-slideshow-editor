import type { MeshData } from './mesh'
import { cloneMeshData } from './mesh'

export interface CameraComponent {
  readonly kind: 'camera'
}

export interface AssetInstanceComponent {
  readonly kind: 'assetInstance'
  readonly assetDefinitionId: string
}

export type TextAlignment = 'left' | 'center' | 'right'

export interface TextComponent {
  readonly kind: 'text'
  readonly content: string
  readonly fontSize: number
  readonly alignment: TextAlignment
}

export interface BoneComponent {
  readonly kind: 'bone'
  readonly length: number
}

export interface MeshComponent {
  readonly kind: 'mesh'
  readonly mesh: MeshData
}

export interface GhostComponent {
  readonly kind: 'ghost'
}

export interface NodeComponents {
  readonly camera?: CameraComponent
  readonly assetInstance?: AssetInstanceComponent
  readonly text?: TextComponent
  readonly bone?: BoneComponent
  readonly mesh?: MeshComponent
  readonly ghost?: GhostComponent
}

export function copyComponents(components: NodeComponents): NodeComponents {
  return {
    camera: components.camera ? { ...components.camera } : undefined,
    assetInstance: components.assetInstance ? { ...components.assetInstance } : undefined,
    text: components.text ? { ...components.text } : undefined,
    bone: components.bone ? { ...components.bone } : undefined,
    mesh: components.mesh ? { kind: 'mesh', mesh: cloneMeshData(components.mesh.mesh) } : undefined,
    ghost: components.ghost ? { ...components.ghost } : undefined,
  }
}
