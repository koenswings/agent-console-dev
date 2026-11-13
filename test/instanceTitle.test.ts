/**
 * instanceCardTitle (idea#190 item 2): display name as the title, app title
 * as a subtitle, unless the name is a placeholder (empty, the instance id,
 * a generated Engine id, or the app id default).
 */
import { describe, it, expect } from 'vitest';
import {
  GENERATED_ID_SUFFIX_LENGTH,
  instanceCardTitle,
  isGeneratedInstanceIdName,
} from '../src/store/instanceTitle';

const SUFFIX = '0123456789abcdefghi'; // 19 lowercase base-36 characters
const GEN_ID = `kolibri-${SUFFIX}`;

const inst = (over: { id?: string; name?: string; instanceOf?: string } = {}) => ({
  id: over.id ?? 'kolibri-otherid00000001',
  name: over.name ?? 'Grade 5A and Form 3',
  instanceOf: over.instanceOf ?? 'kolibri-1.0',
});

const app = (over: { id?: string; name?: string; title?: string } = {}) => ({
  id: over.id ?? 'kolibri-1.0',
  name: over.name ?? 'kolibri',
  title: over.title ?? 'Kolibri',
});

describe('isGeneratedInstanceIdName', () => {
  it(`matches appName plus a hyphen and exactly ${GENERATED_ID_SUFFIX_LENGTH} lowercase base-36 characters`, () => {
    expect(SUFFIX).toHaveLength(GENERATED_ID_SUFFIX_LENGTH);
    expect(isGeneratedInstanceIdName(GEN_ID, 'kolibri')).toBe(true);
    expect(isGeneratedInstanceIdName(`kolibri-channel-builder-${SUFFIX}`, 'kolibri-channel-builder')).toBe(true);
  });

  it('rejects a shorter or longer suffix, uppercase, or a non-base-36 character', () => {
    expect(isGeneratedInstanceIdName('kolibri-0123456789abcdefgh', 'kolibri')).toBe(false); // 18
    expect(isGeneratedInstanceIdName('kolibri-0123456789abcdefghij', 'kolibri')).toBe(false); // 20
    expect(isGeneratedInstanceIdName('kolibri-0123456789ABCDEFGHI', 'kolibri')).toBe(false);
    expect(isGeneratedInstanceIdName('kolibri-0123456789abcdefgh!', 'kolibri')).toBe(false);
  });

  it('does not treat a teacher or lesson name as generated, even when the app slug is a prefix', () => {
    expect(isGeneratedInstanceIdName('Grade 5A and Form 3', 'kolibri')).toBe(false);
    expect(isGeneratedInstanceIdName('Kolibri Form 3', 'kolibri')).toBe(false);
    expect(isGeneratedInstanceIdName('kolibri-grade5a-001', 'kolibri')).toBe(false);
    expect(isGeneratedInstanceIdName('kolibri-1.0', 'kolibri')).toBe(false);
  });
});

describe('instanceCardTitle', () => {
  it('uses the display name as the title and the app title as a subtitle', () => {
    expect(instanceCardTitle(inst(), app())).toEqual({
      title: 'Grade 5A and Form 3',
      subtitle: 'Kolibri',
    });
    expect(instanceCardTitle(inst({ name: 'Kolibri Form 3' }), app())).toEqual({
      title: 'Kolibri Form 3',
      subtitle: 'Kolibri',
    });
  });

  it('does not repeat the app title when it is the same as the display name', () => {
    expect(instanceCardTitle(inst({ name: 'Kolibri' }), app())).toEqual({
      title: 'Kolibri',
      subtitle: null,
    });
  });

  it('falls back to the app title, with no subtitle, when the name is empty or blank', () => {
    expect(instanceCardTitle(inst({ name: '' }), app())).toEqual({ title: 'Kolibri', subtitle: null });
    expect(instanceCardTitle(inst({ name: '   ' }), app())).toEqual({ title: 'Kolibri', subtitle: null });
  });

  it('falls back when the name equals the instance id', () => {
    expect(instanceCardTitle(inst({ id: GEN_ID, name: GEN_ID }), app())).toEqual({
      title: 'Kolibri',
      subtitle: null,
    });
  });

  it('falls back when the name is a generated Engine id even if it differs from inst.id', () => {
    expect(instanceCardTitle(inst({ id: 'other-id', name: GEN_ID }), app())).toEqual({
      title: 'Kolibri',
      subtitle: null,
    });
  });

  it('falls back when the name is the app id (installApp default when --name is omitted)', () => {
    expect(instanceCardTitle(inst({ name: 'kolibri-1.0' }), app())).toEqual({
      title: 'Kolibri',
      subtitle: null,
    });
  });

  it('keeps a Console lesson name such as kolibri-grade5a-001 as the title', () => {
    expect(instanceCardTitle(inst({ name: 'kolibri-grade5a-001' }), app())).toEqual({
      title: 'kolibri-grade5a-001',
      subtitle: 'Kolibri',
    });
  });

  it('when the app record is missing: a real name stays the title; a generated id is not shown as the title', () => {
    expect(instanceCardTitle(inst({ name: 'Grade 5A and Form 3' }), undefined)).toEqual({
      title: 'Grade 5A and Form 3',
      subtitle: null,
    });
    expect(instanceCardTitle(inst({ id: GEN_ID, name: GEN_ID, instanceOf: 'kolibri-1.0' }), undefined)).toEqual({
      title: 'kolibri-1.0',
      subtitle: null,
    });
    expect(instanceCardTitle(inst({ name: GEN_ID, instanceOf: 'kolibri-1.0' }), undefined)).toEqual({
      title: 'kolibri-1.0',
      subtitle: null,
    });
    expect(instanceCardTitle(inst({ name: '' }), undefined)).toEqual({
      title: 'kolibri-1.0',
      subtitle: null,
    });
  });
});
