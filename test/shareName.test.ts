/**
 * idea#132 — createFilesDisk <diskId> [<shareName…>] and the share name rule
 * (≤ 16 bytes; A–Z a–z 0–9, space, hyphen, underscore, parentheses).
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_SHARE_NAME, buildCreateFilesDiskCommand, validateShareName } from '../src/store/commands';

describe('buildCreateFilesDiskCommand', () => {
  it('ID only without a share name', () => {
    expect(buildCreateFilesDiskCommand('DISK_1')).toBe('createFilesDisk DISK_1');
  });
  it('share name last, spaces and parentheses kept (rest of the line)', () => {
    expect(buildCreateFilesDiskCommand('DISK_1', 'My Share (2)')).toBe('createFilesDisk DISK_1 My Share (2)');
    expect(buildCreateFilesDiskCommand('DISK_1', DEFAULT_SHARE_NAME)).toBe('createFilesDisk DISK_1 School Files');
  });
});

describe('validateShareName', () => {
  it.each(['School Files', 'A', 'My Share (2)', 'a-b_c', '1234567890123456'])('accepts %j', (name) => {
    expect(validateShareName(name)).toBeNull();
  });
  it('default is "School Files" and valid', () => {
    expect(DEFAULT_SHARE_NAME).toBe('School Files');
    expect(validateShareName(DEFAULT_SHARE_NAME)).toBeNull();
  });
  it('refuses empty', () => {
    expect(validateShareName('')).toBe('Enter a share name.');
  });
  it('refuses more than 16 characters', () => {
    expect(validateShareName('12345678901234567')).toBe('At most 16 characters.');
  });
  it.each(['Files/1', 'Café', 'a.b', 'x!', 'tab\there', 'emoji🙂'])('refuses characters outside the set: %j', (name) => {
    expect(validateShareName(name)).toBe('Use only letters, digits, spaces, hyphens, underscores and parentheses.');
  });
  it('refuses a leading or trailing space', () => {
    expect(validateShareName(' Files')).toBe('No space at the start or end.');
    expect(validateShareName('Files ')).toBe('No space at the start or end.');
  });
});
