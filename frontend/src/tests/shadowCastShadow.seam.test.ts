import { describe, it, expect, vi } from 'vitest'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { SetShadowEffectCommand, SetCastShadowCommand } from '../engine/commands'
import { DEFAULT_SHADOW_EFFECT, collectShadowCasters, getCastShadow, isCasterRenderable } from '../engine/shadowEffect'
import { SceneNode } from '../engine/sceneNode'

function createSystem() {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const publicEngine = toReadOnly(engine)
  engine.createProject({ name: 'Test' })
  const slide = engine.createSlide('S')
  return { engine, publicEngine, dispatcher, undoStack, slide }
}

describe('Shadow CastShadow seam #300', () => {
  it('getCastShadow returns false for Bone/Ghost/Camera, else n.castShadow ?? true, pruning', () => {
    const { engine } = createSystem()
    const slide = engine.getSlide(engine.activeSlideId!)
    const group = engine.createNode(slide.scene.id, slide.scene.root.id, 'Group')
    const bone = engine.createNode(slide.scene.id, group.id, 'Bone', { components: { bone: { kind: 'bone', length: 20 } } })
    const ghost = engine.createNode(slide.scene.id, group.id, 'Ghost', { components: { ghost: { kind: 'ghost' } } })
    const asset = engine.createNode(slide.scene.id, group.id, 'Asset', { components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def1' } } })
    const text = engine.createNode(slide.scene.id, group.id, 'Text', { components: { text: { kind: 'text', content: 'hi', fontSize: 12, alignment: 'left' } } })

    expect(getCastShadow(bone)).toBe(false)
    expect(getCastShadow(ghost)).toBe(false)
    const camera = slide.scene.camera
    expect(getCastShadow(camera)).toBe(false)

    // asset default true
    expect(getCastShadow(asset)).toBe(true)
    expect(getCastShadow(text)).toBe(true)

    // set castShadow false on asset
    asset.castShadow = false
    expect(getCastShadow(asset)).toBe(false)
    asset.castShadow = true
    expect(getCastShadow(asset)).toBe(true)

    // Bone with explicit true still false
    bone.castShadow = true as unknown as boolean
    expect(getCastShadow(bone)).toBe(false)
  })

  it('Cast Shadow = false prunes entire subtree — child cannot re-enable', () => {
    const { engine, dispatcher, publicEngine } = createSystem()
    const slide = engine.getSlide(engine.activeSlideId!)
    const host = engine.createNode(slide.scene.id, slide.scene.root.id, 'HostGroup')
    const limb = engine.createNode(slide.scene.id, host.id, 'LimbGroup')
    const childAsset = engine.createNode(slide.scene.id, limb.id, 'ChildAsset', { components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def1' } } })
    // Need circle or mesh for renderable check — assetInstance is renderable
    engine.createNode(slide.scene.id, host.id, 'Accessory', { components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 360 } } })
    // Limb has accessory limb toggled off drops from silhouette
    // Initially all true => host's silhouette includes accessory and childAsset
    let casters = collectShadowCasters(host as unknown as { children: readonly unknown[] }) as SceneNode[]
    expect(casters.map(c=>c.name)).toEqual(expect.arrayContaining(['Accessory', 'ChildAsset']))

    // Set limb castShadow false => childAsset should be pruned even though childAsset castShadow true
    dispatcher.dispatch(new SetCastShadowCommand({ nodeId: limb.id, castShadow: false }))
    expect(publicEngine.getCastShadow(limb.id)).toBe(false)
    // childAsset explicitly true but pruned by ancestor
    childAsset.castShadow = true
    casters = collectShadowCasters(host as unknown as { children: readonly unknown[] }) as SceneNode[]
    expect(casters.map(c=>c.name)).not.toContain('ChildAsset')
    expect(casters.map(c=>c.name)).toContain('Accessory')

    // Restore limb true => child reappears
    dispatcher.dispatch(new SetCastShadowCommand({ nodeId: limb.id, castShadow: true }))
    casters = collectShadowCasters(host as unknown as { children: readonly unknown[] }) as SceneNode[]
    expect(casters.map(c=>c.name)).toContain('ChildAsset')
  })

  it('Bone prunes, placeholder casts', () => {
    const { engine } = createSystem()
    const slide = engine.getSlide(engine.activeSlideId!)
    const host = engine.createNode(slide.scene.id, slide.scene.root.id, 'Host')
    const boneGroup = engine.createNode(slide.scene.id, host.id, 'BoneGroup', { components: { bone: { kind: 'bone', length: 30 } } })
    const boneChild = engine.createNode(slide.scene.id, boneGroup.id, 'BoneChild', { components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'defX' } } })
    const placeholder = engine.createNode(slide.scene.id, host.id, 'Placeholder', { components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'missingId' } } })

    // Bone child should be pruned because bone parent castShadow false
    let casters = collectShadowCasters(host as unknown as { children: readonly unknown[] }) as SceneNode[]
    expect(casters.map(c=>c.id)).not.toContain(boneChild.id)
    expect(casters.map(c=>c.id)).toContain(placeholder.id)
    expect(isCasterRenderable(placeholder)).toBe(true)
    expect(getCastShadow(placeholder)).toBe(true)
  })

  it('Nested group with its own Shadow Effect is still included in its parent Silhouette', () => {
    const { engine, dispatcher } = createSystem()
    const slide = engine.getSlide(engine.activeSlideId!)
    const parentGroup = engine.createNode(slide.scene.id, slide.scene.root.id, 'ParentGroup')
    const childGroup = engine.createNode(slide.scene.id, parentGroup.id, 'ChildGroup')
    const childAsset = engine.createNode(slide.scene.id, childGroup.id, 'ChildAsset', { components: { mesh: { kind: 'mesh', mesh: { vertices: [{x:0,y:0},{x:1,y:0},{x:0,y:1}], faces: [{v0:0,v1:1,v2:2}], uvs: [] } } } })
    // Give childGroup its own shadowEffect
    dispatcher.dispatch(new SetShadowEffectCommand({ nodeId: childGroup.id, shadowEffect: DEFAULT_SHADOW_EFFECT }))
    expect(engine.getNode(childGroup.id).shadowEffect).toBeDefined()
    // Parent group's silhouette should include childAsset
    const casters = collectShadowCasters(parentGroup as unknown as { children: readonly unknown[] }) as SceneNode[]
    expect(casters.map(c=>c.id)).toContain(childAsset.id)
    // Child's projection Sprite is Pixi, not SceneNode, so not in collector by construction — we ensure collector doesn't include group itself
    expect(casters.map(c=>c.id)).not.toContain(childGroup.id)
  })

  it('Silhouette covers all renderable kinds', () => {
    const { engine } = createSystem()
    const slide = engine.getSlide(engine.activeSlideId!)
    const host = engine.createNode(slide.scene.id, slide.scene.root.id, 'Host')
    const nodes: SceneNode[] = []
    nodes.push(engine.createNode(slide.scene.id, host.id, 'Asset', { components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'a' } } }))
    nodes.push(engine.createNode(slide.scene.id, host.id, 'Text', { components: { text: { kind: 'text', content: 'hi', fontSize: 12, alignment: 'left' } } }))
    nodes.push(engine.createNode(slide.scene.id, host.id, 'Mesh', { components: { mesh: { kind: 'mesh', mesh: { vertices: [{x:0,y:0},{x:1,y:0},{x:0,y:1}], faces: [{v0:0,v1:1,v2:2}], uvs: [] } } } }))
    nodes.push(engine.createNode(slide.scene.id, host.id, 'Circle', { components: { circle: { kind: 'circle', radius: 5, startAngle: 0, endAngle: 360 } } }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nodes.push(engine.createNode(slide.scene.id, host.id, 'Table', { components: { table: { kind: 'table', columns: [{width:100}], gap:0, borderWidth:1, borderColor:'#000', borderRadius:0, padding:0 } } as any }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nodes.push(engine.createNode(slide.scene.id, host.id, 'Row', { components: { tableRow: { kind: 'tableRow' } } as any }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nodes.push(engine.createNode(slide.scene.id, host.id, 'Cell', { components: { tableCell: { kind: 'tableCell', colSpan: 1, rowSpan: 1 } } as any }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nodes.push(engine.createNode(slide.scene.id, host.id, 'Chart', { components: { chart: { kind: 'chart', chartType: 'bar', dataSourceId: 'ds', visualConfig: { colors: [], axisLabels: {x:'',y:''}, legendPosition: 'none', padding: 0, fontFamily: '', fontSize: 12 }, dataLabels: [], _dirty: false } } as any }))

    const casters = collectShadowCasters(host as unknown as { children: readonly unknown[] }) as SceneNode[]
    for (const n of nodes) {
      expect(casterSetContains(casters, n.id)).toBe(true)
    }
    // Group itself not caster
    const group = engine.createNode(slide.scene.id, host.id, 'EmptyGroup')
    engine.createNode(slide.scene.id, group.id, 'Dummy', { components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'a2' } } })
    // EmptyGroup is a group node (no components, has child), should not be caster itself but its child should
    const casters2 = collectShadowCasters(host as unknown as { children: readonly unknown[] }) as SceneNode[]
    expect(casters2.map(c=>c.id)).not.toContain(group.id)
    expect(casters2.map(c=>c.name)).toContain('Dummy')
  })

  function casterSetContains(casters: SceneNode[], id: string): boolean {
    return casters.some(c=>c.id===id)
  }

  it('Command SetCastShadow with one HistoryEntry and JSON round-trip', () => {
    const { engine, dispatcher, undoStack, publicEngine } = createSystem()
    const slide = engine.getSlide(engine.activeSlideId!)
    const host = engine.createNode(slide.scene.id, slide.scene.root.id, 'Host')
    const asset = engine.createNode(slide.scene.id, host.id, 'Asset', { components: { circle: { kind: 'circle', radius: 5, startAngle: 0, endAngle: 360 } } })
    const before = undoStack.entries.length
    const r = dispatcher.dispatch(new SetCastShadowCommand({ nodeId: asset.id, castShadow: false }))
    expect(r.ok).toBe(true)
    expect(undoStack.entries.length).toBe(before+1)
    expect(undoStack.entries[0].type).toBe('SetCastShadow')
    expect(engine.getNode(asset.id).castShadow).toBe(false)
    expect(publicEngine.getCastShadow(asset.id)).toBe(false)

    // JSON carries castShadow
    const json = asset.toJSON()
    expect(json.castShadow).toBe(false)
    const recovered = SceneNode.fromJSON(json)
    expect(recovered.castShadow).toBe(false)

    // LessonSerializer round-trip via engine toJSON/restore
    const lessonJson = publicEngine.toJSON()
    const warn = vi.spyOn(console, 'warn').mockImplementation(()=>undefined)
    publicEngine.restoreFromJSON(lessonJson)
    warn.mockRestore()
    expect(publicEngine.getCastShadow(asset.id)).toBe(false)

    // Undo
    dispatcher.undo()
    expect(engine.getNode(asset.id).castShadow).toBeUndefined()
    expect(publicEngine.getCastShadow(asset.id)).toBe(true)
    // Redo
    dispatcher.redo()
    expect(engine.getNode(asset.id).castShadow).toBe(false)
  })

  it('LessonSerializer tolerant: missing castShadow and bad values', () => {
    const { engine } = createSystem()
    const slide = engine.getSlide(engine.activeSlideId!)
    const host = engine.createNode(slide.scene.id, slide.scene.root.id, 'Host')
    const asset = engine.createNode(slide.scene.id, host.id, 'Asset', { components: { text: { kind: 'text', content: 'hi', fontSize: 12, alignment: 'left' } } })
    const json = asset.toJSON()
    expect(json.castShadow).toBeUndefined()
    // Legacy without castShadow should load
    const legacy = { ...json }
    delete (legacy as unknown as Record<string, unknown>).castShadow
    const node = SceneNode.fromJSON(legacy as unknown as import('../engine/json').NodeJSON)
    expect(node.castShadow).toBeUndefined()
    expect(getCastShadow(node as unknown as { components: Record<string, unknown>; castShadow?: boolean })).toBe(true)

    // Bad value warn
    const warn = vi.spyOn(console, 'warn').mockImplementation(()=>undefined)
    const bad = { ...json, castShadow: 'notabool' as unknown as boolean }
    const badNode = SceneNode.fromJSON(bad as unknown as import('../engine/json').NodeJSON)
    expect(badNode.castShadow).toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('copy / duplicate / ReusableObject preserves castShadow', async () => {
    const { engine, dispatcher } = createSystem()
    engine.registerAssetDefinition('def1', 'Def1')
    const slide = engine.getSlide(engine.activeSlideId!)
    const host = engine.createNode(slide.scene.id, slide.scene.root.id, 'Host')
    const asset = engine.createNode(slide.scene.id, host.id, 'Asset', { components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def1' } } })
    dispatcher.dispatch(new SetCastShadowCommand({ nodeId: asset.id, castShadow: false }))
    expect(asset.castShadow).toBe(false)

    // Test copy via SceneManager copyScene (duplicateSlide)
    const copySlide = engine.duplicateSlide(slide.id)
    // Find copied asset via walk
    function* walkNodes(root: SceneNode): Iterable<SceneNode> {
      const stack: SceneNode[] = [root]
      while(stack.length){ const cur=stack.pop()!; yield cur; for(let i=cur.children.length-1;i>=0;i--) stack.push(cur.children[i]) }
    }
    let copiedAsset: SceneNode | undefined
    for(const n of walkNodes(copySlide.scene.root)){
      if(n.name==='Asset' && n.id!==asset.id) copiedAsset=n
    }
    expect(copiedAsset).toBeDefined()
    expect(copiedAsset!.castShadow).toBe(false)

    // Duplicate node via command (duplicate asset instance)
    const { DuplicateNodeCommand } = await import('../engine/commands')
    const dupResult = dispatcher.dispatch(new DuplicateNodeCommand({ nodeId: asset.id }))
    expect(dupResult.ok).toBe(true)
    // Find duplicate by name with offset
    let dupNode: SceneNode | undefined
    for(const n of walkNodes(slide.scene.root)){
      if(n.name.startsWith('Asset') && n.id!==asset.id && n.id!==copiedAsset!.id) dupNode=n
    }
    if(dupNode){
      expect(dupNode.castShadow).toBe(false)
    }

    // ReusableObject
    engine.setActiveSlide(slide.id)
    const objJson = engine.exportReusableObject(host.id, 'HostObject')
    // Find exported node castShadow
    const exportedAssetJson = objJson.nodes.find(n=>n.name==='Asset')
    expect(exportedAssetJson?.castShadow).toBe(false)
    // Import
    const imported = engine.importReusableObject(objJson, slide.scene.root.id)
    const newAssetId = imported.nodeIdMap.get(asset.id)!
    const importedAsset = engine.getNode(newAssetId)
    expect(importedAsset.castShadow).toBe(false)
  })
})
