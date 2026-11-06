import { beforeEach, describe, expect, it } from 'vitest'
import { aiActiveKey, useAiStore } from '../stores/aiStore'

describe('slide-scoped Audio conversations', () => {
  beforeEach(() => {
    useAiStore.setState({
      activeByProject: {},
      audioConversationSlideById: {},
    })
  })

  it('uses a distinct active conversation key for each Slide without changing other modes', () => {
    expect(aiActiveKey('project', 'audio', 'slide-a')).not.toBe(
      aiActiveKey('project', 'audio', 'slide-b'),
    )
    expect(aiActiveKey('project', 'animation', 'slide-a')).toBe(
      aiActiveKey('project', 'animation', 'slide-b'),
    )
  })

  it('keeps Audio history bound to its owning Slide', () => {
    useAiStore.setState({
      activeByProject: { [aiActiveKey('project', 'audio', 'slide-a')]: 'conversation-a' },
      audioConversationSlideById: { 'conversation-a': 'slide-a' },
    })

    expect(useAiStore.getState().activeIdFor('project', 'audio', 'slide-a')).toBe('conversation-a')
    expect(useAiStore.getState().activeIdFor('project', 'audio', 'slide-b')).toBeNull()

    useAiStore.getState().setActive('project', 'conversation-a', 'audio', 'slide-b')
    expect(useAiStore.getState().activeIdFor('project', 'audio', 'slide-b')).toBeNull()
  })
})
