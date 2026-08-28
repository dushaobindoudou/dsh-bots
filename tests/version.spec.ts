import { describe, expect, it } from 'vitest'
import { satisfiesCaret } from '../src/version.js'

describe('satisfiesCaret', () => {
  it('matches the documented behavior of ^0.1.0-rc.6', () => {
    expect(satisfiesCaret('0.1.0-rc.3', '^0.1.0-rc.6')).toBe(false)
    expect(satisfiesCaret('0.1.0-rc.5', '^0.1.0-rc.6')).toBe(false)
    expect(satisfiesCaret('0.1.0-rc.6', '^0.1.0-rc.6')).toBe(true)
    expect(satisfiesCaret('0.1.0-rc.7', '^0.1.0-rc.6')).toBe(true)
    expect(satisfiesCaret('0.1.0-rc.10', '^0.1.0-rc.6')).toBe(true)
    expect(satisfiesCaret('0.1.0', '^0.1.0-rc.6')).toBe(true)
    expect(satisfiesCaret('0.0.1-rc.1', '^0.1.0-rc.6')).toBe(false)
    expect(satisfiesCaret('0.2.0', '^0.1.0-rc.6')).toBe(false)
    expect(satisfiesCaret('1.0.0', '^0.1.0-rc.6')).toBe(false)
  })

  it('handles stable caret ranges', () => {
    expect(satisfiesCaret('0.1.0', '^0.1.0')).toBe(true)
    expect(satisfiesCaret('0.1.5', '^0.1.0')).toBe(true)
    expect(satisfiesCaret('0.2.0', '^0.1.0')).toBe(false)
    expect(satisfiesCaret('0.1.0-rc.1', '^0.1.0')).toBe(false)
    expect(satisfiesCaret('1.9.9', '^1.2.3')).toBe(true)
    expect(satisfiesCaret('2.0.0', '^1.2.3')).toBe(false)
  })

  it('rejects malformed input', () => {
    expect(satisfiesCaret('not-a-version', '^0.1.0-rc.6')).toBe(false)
    expect(satisfiesCaret('0.1.0', '0.1.0-rc.6')).toBe(false)
    expect(satisfiesCaret('0.1.0', '~0.1.0')).toBe(false)
  })
})
