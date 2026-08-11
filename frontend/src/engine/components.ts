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

export interface NodeComponents {
  readonly camera?: CameraComponent
  readonly assetInstance?: AssetInstanceComponent
  readonly text?: TextComponent
}
