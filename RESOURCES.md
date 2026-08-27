# AnimatedSlidesRedactor Resources

## Knowledge

- [Refactoring.Guru — Command Pattern](https://refactoring.guru/design-patterns/command)
  Canonical GoF Command pattern reference with UML, applicability, and trade-offs. Use for: understanding the undo/redo command system in `frontend/src/engine/commands/`.

- [Martin Fowler — GUI Architectures](https://martinfowler.com/eaaDev/uiArchs.html)
  How command/history stacks interact with MVC and presentation-domain separation. Use for: understanding how the engine, stores, and React UI connect.

- [Martin Fowler — Presentation Domain Data Layering](https://martinfowler.com/bliki/PresentationDomainDataLayering.html)
  The three-layer model (Presentation → Domain → Data Source). Use for: understanding why the engine is framework-agnostic and how the backend fits.

- [Sander Mertens — ECS FAQ](https://github.com/SanderMertens/ecs-faq)
  Comprehensive ECS reference covering entities, components, systems, and design trade-offs. Use for: understanding the `NodeComponents` discriminated-union pattern in scene nodes.

- [PixiJS — Architecture](https://pixijs.com/8.x/guides/concepts/architecture)
  PixiJS renderer, Container scene graph, and extension system. Use for: understanding `frontend/src/pixi/renderer/`.

- [PixiJS — Scene Graph](https://pixijs.com/8.x/guides/concepts/scene-graph)
  Parent-child transforms, worldTransform, render order, coordinate systems. Use for: how the renderer maps engine nodes to Pixi containers.

## Wisdom (Communities)

- [r/typescript](https://reddit.com/r/typescript)
  High-signal subreddit for TypeScript patterns and architecture discussions. Use for: pattern validation, alternative approaches.

- [PixiJS Discord](https://discord.gg/pixijs)
  Official PixiJS community. Use for: renderer-specific questions, performance optimization.
