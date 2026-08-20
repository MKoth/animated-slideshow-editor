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
}

export interface MeshComponent {
  readonly kind: 'mesh'
  readonly mesh: MeshData
}

export interface NodeComponents {
  readonly camera?: CameraComponent
  readonly assetInstance?: AssetInstanceComponent
  readonly text?: TextComponent
  readonly bone?: BoneComponent
  readonly mesh?: MeshComponent
}

export function copyComponents(components: NodeComponents): NodeComponents {
  return {
    camera: components.camera ? { ...components.camera } : undefined,
    assetInstance: components.assetInstance ? { ...components.assetInstance } : undefined,
    text: components.text ? { ...components.text } : undefined,
    bone: components.bone ? { ...components.bone } : undefined,
    mesh: components.mesh
      ? { kind: 'mesh', mesh: cloneMeshData(components.mesh.mesh) }
      : undefined,
  }
}
