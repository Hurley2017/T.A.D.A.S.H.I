import { describe, expect, it } from 'vitest';
import { assertAgentWorkspace } from '../../packages/agents/src';
import { isInsideProject } from '../../packages/agents/src/process-sandbox';

if (process.platform === 'win32') {
  describe('workspace safety', () => {
    it('accepts the project root and descendants', () => {
      expect(isInsideProject('C:\\projects\\demo', 'C:\\projects\\demo')).toBe(true);
      expect(isInsideProject('C:\\projects\\demo', 'C:\\projects\\demo\\src\\App.tsx')).toBe(true);
    });

    it('rejects traversal outside the project', () => {
      expect(isInsideProject('C:\\projects\\demo', 'C:\\projects\\other')).toBe(false);
      expect(() => assertAgentWorkspace('C:\\projects\\other', 'C:\\projects\\demo')).toThrow('selected project');
    });
  });
}

describe('workspace safety exports', () => {
  it('exports a callable path guard', () => {
    expect(typeof assertAgentWorkspace).toBe('function');
  });
});
