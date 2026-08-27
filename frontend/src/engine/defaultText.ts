import type { TextComponent } from './components'

export function defaultTextComponent(): TextComponent {
  return {
    kind: 'text',
    content: 'Text',
    fontSize: 24,
    alignment: 'left',
  }
}
