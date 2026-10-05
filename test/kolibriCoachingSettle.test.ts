import { describe, it, expect, afterEach } from 'vitest';
import {
  classifyCoachPage,
  coachSettleMs,
  isLessonDetailUrl,
} from '../e2e/intents/kolibriCoaching';

const LIST = 'http://idea01:18080/en/coach/#/a12df5408d20cbe5fd00c0cb036f48f6/plan/lessons';
const LESSON = '2a955770551f7d583c31104f39653fdf';

describe('classifyCoachPage (build_lesson settle)', () => {
  it('is loading while the lessons list has not rendered (r4 abort at ~1.3s)', () => {
    expect(classifyCoachPage({ url: LIST, hasTarget: false, hasPasswordField: false })).toBe('loading');
  });

  it('is target once the lesson row or NEW LESSON is present', () => {
    expect(classifyCoachPage({ url: LIST, hasTarget: true, hasPasswordField: false })).toBe('target');
  });

  it('detects a Kolibri sign-in bounce', () => {
    expect(
      classifyCoachPage({
        url: 'http://idea01:18080/en/auth/#/signin?next=%2Fen%2Fcoach%2F',
        hasTarget: false,
        hasPasswordField: false,
      }),
    ).toBe('signin');
    expect(classifyCoachPage({ url: LIST, hasTarget: false, hasPasswordField: true })).toBe('signin');
  });
});

describe('isLessonDetailUrl', () => {
  it('accepts the pinned lesson id or any /plan/lessons/<id> summary route', () => {
    expect(isLessonDetailUrl(`${LIST}/${LESSON}`, [LESSON])).toBe(true);
    expect(isLessonDetailUrl(`${LIST}/ffffffffffffffffffffffffffffffff?x=1`, [LESSON])).toBe(true);
  });

  it('rejects the bare lessons list and empty URLs', () => {
    expect(isLessonDetailUrl(LIST, [LESSON])).toBe(false);
    expect(isLessonDetailUrl(`${LIST}/`, [LESSON])).toBe(false);
    expect(isLessonDetailUrl('', [LESSON])).toBe(false);
  });
});

describe('coachSettleMs', () => {
  const prev = process.env.DURATION_COACH_SETTLE_MS;
  afterEach(() => {
    if (prev === undefined) delete process.env.DURATION_COACH_SETTLE_MS;
    else process.env.DURATION_COACH_SETTLE_MS = prev;
  });

  it('defaults to 30s and honours DURATION_COACH_SETTLE_MS', () => {
    delete process.env.DURATION_COACH_SETTLE_MS;
    expect(coachSettleMs()).toBe(30_000);
    process.env.DURATION_COACH_SETTLE_MS = '45000';
    expect(coachSettleMs()).toBe(45_000);
    process.env.DURATION_COACH_SETTLE_MS = 'nope';
    expect(coachSettleMs()).toBe(30_000);
  });
});
