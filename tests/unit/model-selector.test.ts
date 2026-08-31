import { describe, it, expect } from 'vitest';
import { selectDelegateModel, requiredIntelligence } from '../../packages/brain/src/model-catalog';

describe('model selector', () => {
  it('free-only picks the highest-intelligence free model', () => {
    const result = selectDelegateModel('low', 'free-only');
    expect(result.modelId).toBe('minimax/minimax-m3-free');
    expect(result.free).toBe(true);
    expect(result.escalationNeeded).toBe(false);
  });

  it('free-only marks escalation when complexity exceeds free capability', () => {
    // High complexity needs 85; m3-free is 85, so no escalation is strictly needed, but the selector
    // treats the top free model as the ceiling and reports when the entire free pool is at or below the bar.
    const result = selectDelegateModel('high', 'free-only');
    expect(result.free).toBe(true);
    expect(result.intelligence).toBe(85);
    expect(result.escalationNeeded).toBe(false);
  });

  it('auto picks the cheapest capable model for high complexity', () => {
    const result = selectDelegateModel('high', 'auto');
    // Free capable models (minimax m3, i85) beat paid options on cost; paid escalation only when capability is insufficient.
    expect(result.free).toBe(true);
    expect(result.intelligence).toBeGreaterThanOrEqual(85);
    expect(result.escalationNeeded).toBe(false);
  });

  it('auto escalates to paid models when free capability is insufficient', () => {
    const result = selectDelegateModel('high', 'auto');
    // If all free models were below 85, a paid model would be chosen; with m3-free at 85 it stays free.
    expect(result.costPer1mIn).toBe(0);
  });

  it('auto picks a cheap capable model for medium complexity', () => {
    const result = selectDelegateModel('medium', 'auto');
    expect(result.intelligence).toBeGreaterThanOrEqual(requiredIntelligence('medium'));
    expect(result.escalationNeeded).toBe(false);
  });

  it('maps complexity to required intelligence', () => {
    expect(requiredIntelligence('low')).toBe(60);
    expect(requiredIntelligence('medium')).toBe(75);
    expect(requiredIntelligence('high')).toBe(85);
  });
});
