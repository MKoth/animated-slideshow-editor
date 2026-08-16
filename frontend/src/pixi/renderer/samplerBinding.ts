import type { ShaderSamplerBinding } from '../../engine/materialResolution'
import type { PixiFilter } from './pixi'
import type { ResolveAssetUrl, TextureCache } from './textureCache'

/**
 * Bind every resolved sampler2D uniform to its asset texture: the cached
 * placeholder source is bound immediately so the filter renders, and the real
 * texture source replaces it once loaded. A sampler that resolves to no asset —
 * an empty or missing asset definition id, or an asset without a resolvable url —
 * samples the per-key placeholder, so it never reads an uninitialized unit.
 *
 * Samplers live as bind-group texture resources, never in the uniform group:
 * pixi uploads samplers only through TextureSource resources, and a uniform-key
 * without a matching structure crashes its generated uniform sync.
 */
export function bindFilterSamplers(
  filter: PixiFilter,
  samplers: readonly ShaderSamplerBinding[],
  resolveAssetUrl: ResolveAssetUrl,
  textures: TextureCache,
): void {
  const resources = filter.resources as Record<string, unknown>
  for (const sampler of samplers) {
    const assetDefinitionId = sampler.assetDefinitionId
    if (assetDefinitionId === null) {
      resources[sampler.key] = textures.get(sampler.key).source
      continue
    }
    const url = resolveAssetUrl(assetDefinitionId)
    if (!url) {
      resources[sampler.key] = textures.get(sampler.key).source
      continue
    }
    const placeholder = textures.get(assetDefinitionId)
    resources[sampler.key] = placeholder.source
    void textures.load(url, assetDefinitionId).then((result) => {
      // Skip a stale load: the sampler was rebound to another asset while
      // this texture was still resolving.
      if (resources[sampler.key] !== placeholder.source) {
        return
      }
      resources[sampler.key] = result.texture.source
    })
  }
}
