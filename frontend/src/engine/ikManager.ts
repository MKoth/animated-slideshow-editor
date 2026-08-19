import type { EventBus } from './events'
import type { SceneNode } from './sceneNode'
import { IKChain, type BoneIKTarget, type PoleTarget } from './ikChain'
import { newId } from './ids'

export class IKManager {
  readonly #bus: EventBus
  readonly #nodeLookup: (nodeId: string) => SceneNode
  readonly #chains = new Map<string, IKChain>()
  readonly #slideChains = new Map<string, Set<string>>()

  constructor(
    bus: EventBus,
    nodeLookup: (nodeId: string) => SceneNode,
  ) {
    this.#bus = bus
    this.#nodeLookup = nodeLookup
  }

  createChain(
    slideId: string,
    boneIds: readonly string[],
    target: BoneIKTarget,
    poleTarget: PoleTarget | null = null,
  ): IKChain {
    const id = newId('ikChain')
    const chain = new IKChain(id, boneIds, target, poleTarget)
    const error = chain.validate(this.#nodeLookup)
    if (error) {
      throw new Error(error)
    }
    this.#chains.set(id, chain)
    let slideSet = this.#slideChains.get(slideId)
    if (!slideSet) {
      slideSet = new Set()
      this.#slideChains.set(slideId, slideSet)
    }
    slideSet.add(id)
    this.#bus.emit({ type: 'IKChainCreated', chainId: id, slideId })
    return chain
  }

  deleteChain(chainId: string): IKChain {
    const chain = this.#chains.get(chainId)
    if (!chain) {
      throw new Error(`IK chain not found: ${chainId}`)
    }
    this.#chains.delete(chainId)
    // Remove from slide mapping
    for (const [slideId, set] of this.#slideChains) {
      if (set.delete(chainId)) {
        if (set.size === 0) {
          this.#slideChains.delete(slideId)
        }
        this.#bus.emit({ type: 'IKChainDeleted', chainId, slideId })
        break
      }
    }
    return chain
  }

  getChain(chainId: string): IKChain {
    const chain = this.#chains.get(chainId)
    if (!chain) {
      throw new Error(`IK chain not found: ${chainId}`)
    }
    return chain
  }

  getChainsForSlide(slideId: string): readonly IKChain[] {
    const ids = this.#slideChains.get(slideId)
    if (!ids) {
      return []
    }
    return [...ids].map((id) => this.#chains.get(id)!)
  }

  getChainsForBone(boneId: string): readonly IKChain[] {
    const result: IKChain[] = []
    for (const chain of this.#chains.values()) {
      if (chain.boneIds.includes(boneId)) {
        result.push(chain)
      }
    }
    return result
  }

  setTarget(chainId: string, target: BoneIKTarget): void {
    const chain = this.getChain(chainId)
    ;(chain as { target: BoneIKTarget }).target = target
    this.#bus.emit({ type: 'IKTargetChanged', chainId })
  }

  setPoleTarget(chainId: string, poleTarget: PoleTarget | null): void {
    const chain = this.getChain(chainId)
    ;(chain as { poleTarget: PoleTarget | null }).poleTarget = poleTarget
    this.#bus.emit({ type: 'IKPoleTargetChanged', chainId })
  }

  /** Remove all chains for a slide (used when slide is deleted). */
  clearSlide(slideId: string): void {
    const ids = this.#slideChains.get(slideId)
    if (!ids) {
      return
    }
    for (const chainId of ids) {
      this.#chains.delete(chainId)
    }
    this.#slideChains.delete(slideId)
  }

  clear(): void {
    this.#chains.clear()
    this.#slideChains.clear()
  }

  toJSON(): IKManagerJSON {
    const slides: Record<string, string[]> = {}
    for (const [slideId, ids] of this.#slideChains) {
      slides[slideId] = [...ids]
    }
    const chains: IKChainJSON[] = []
    for (const chain of this.#chains.values()) {
      chains.push(chain.toJSON())
    }
    return { slides, chains }
  }

  restoreFromJSON(json: IKManagerJSON): void {
    this.clear()
    for (const chainJson of json.chains) {
      const chain = IKChain.fromJSON(chainJson)
      this.#chains.set(chain.id, chain)
    }
    for (const [slideId, ids] of Object.entries(json.slides)) {
      this.#slideChains.set(slideId, new Set(ids))
    }
  }
}

interface IKManagerJSON {
  readonly slides: Record<string, readonly string[]>
  readonly chains: readonly IKChainJSON[]
}

interface IKChainJSON {
  readonly id: string
  readonly boneIds: readonly string[]
  readonly target: BoneIKTarget
  readonly poleTarget: PoleTarget | null
}