import { describe, expect, it } from 'vitest';

import { openCodeSystemTempDirectories } from '../../src/runtimes/opencode-permissions.js';

describe('openCodeSystemTempDirectories', () => {
  it('grants the process temp dir and the literal /tmp agents write to on POSIX', () => {
    expect(openCodeSystemTempDirectories(() => '/var/folders/ab/T', 'darwin')).toEqual([
      '/var/folders/ab/T',
      '/tmp',
    ]);
    expect(openCodeSystemTempDirectories(() => '/tmp', 'linux')).toEqual(['/tmp']);
  });

  it('grants only %TEMP% on Windows', () => {
    expect(
      openCodeSystemTempDirectories(() => 'C:\\Users\\me\\AppData\\Local\\Temp', 'win32'),
    ).toEqual(['C:\\Users\\me\\AppData\\Local\\Temp']);
  });
});
