import type { ShaderSamplerBinding } from '../../engine/materialResolution'
import type { PixiFilter } from './pixi'
import { nodeFilterUniforms } from './nodeShader'
import type { ResolveAssetUrl } from './textureCache'
import { TextureCache } from './textureCache'

/**
 * Bind every resolved sampler2D uniform to its asset texture: the cached
 * placeholder is bound immediately so the filter renders, and the real
 * texture replaces it once loaded. A sampler that resolves to no asset — an
 * empty or missing asset definition id, or an asset without a resolvable url —
 * is unbound (deleted), so it samples the default texture unit.
 */
export function bindFilterSamplers(
  filter: PixiFilter,
  samplers: readonly ShaderSamplerBinding[],
  resolveAssetUrl: ResolveAssetUrl,
  textures: TextureCache,
): void {
  const uniforms = nodeFilterUniforms(filter)
  for (const sampler of samplers) {
    const assetDefinitionId = sampler.assetDefinitionId
    if (assetDefinitionId === null) {
      delete uniforms[sampler.key]
      continue
    }
    const url = resolveAssetUrl(assetDefinitionId)
    if (!url) {
      delete uniforms[sampler.key]
      continue
    }
    const placeholder = textures.get(assetDefinitionId)
    uniforms[sampler.key] = placeholder
    const load = textures.load(url, assetDefinitionId)
    void load.then((result) => {
      // Skip a stale load: the sampler was rebound to another asset while
      // this texture was still resolving.
      if (uniforms[sampler.key] !== placeholder) {
        return
      }
      uniforms[sampler.key] = result.texture
    })
  }
}
