# Scene graph understanding established

The user now understands the scene graph architecture: tree-based nodes with parent-child relationships, the ECS-like component system (frozen discriminated unions, not class hierarchy), local vs world transforms with dirty flagging and lazy evaluation, the camera-as-viewport pattern, and the Scene wrapper with flat O(1) lookup. Key insight captured: components are frozen and immutable — change requires replacing the whole object. This unlocks understanding of how the renderer maps engine nodes to Pixi containers via events.
