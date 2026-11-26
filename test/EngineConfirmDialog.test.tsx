/**
 * agent-engine-dev#582: the Engine's confirmation dialog (428 summary).
 * Erase: the disk name must be typed exactly. Flash: no typing, Confirm sends the size.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import EngineConfirmDialog from '../src/components/EngineConfirmDialog';
import { answerEngineConfirm, requestEngineConfirm } from '../src/store/engineConfirm';
import type { ConfirmRequest } from '../src/store/signedCommand';

const req = (over: Partial<ConfirmRequest>): ConfirmRequest => ({
  engineId: 'E1',
  command: 'eraseDisk D1 sum-1 Stick',
  confirmId: 'cf-1',
  summary: { command: 'eraseDisk', targetId: 'D1', label: 'Stick', sizeBytes: 8_000_000_000, device: '/dev/sdb', apps: ['kolibri 0.16'] },
  expiresInMs: 60_000,
  confirmField: 'label',
  message: 'Confirm on the Engine.',
  ...over,
});

afterEach(() => { answerEngineConfirm(null); cleanup(); });

describe('EngineConfirmDialog', () => {
  it('erase: shows the summary without ids, needs the exact disk name', async () => {
    render(() => <EngineConfirmDialog />);
    const answer = requestEngineConfirm(req({}), 'appdocker01');
    const summary = await screen.findByTestId('engine-confirm-summary');
    expect(summary.textContent).toContain('Stick');
    expect(summary.textContent).toContain('kolibri 0.16');
    expect(summary.textContent).not.toContain('D1');
    const ok = screen.getByTestId('engine-confirm-ok') as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    fireEvent.input(screen.getByTestId('engine-confirm-input'), { target: { value: 'stick' } });
    expect(ok.disabled).toBe(true);
    fireEvent.input(screen.getByTestId('engine-confirm-input'), { target: { value: 'Stick' } });
    expect(ok.disabled).toBe(false);
    fireEvent.click(ok);
    expect(await answer).toBe('Stick');
    expect(screen.queryByTestId('engine-confirm')).toBeNull();
  });

  it('flash: no input; Confirm answers with the card size', async () => {
    render(() => <EngineConfirmDialog />);
    const answer = requestEngineConfirm(
      req({ command: 'flashCard C1 1.2 31914983424', confirmField: 'sizeBytes', summary: { command: 'flashCard', candidateId: 'C1', sizeBytes: 31914983424, model: 'SanDisk', version: '1.2' } }),
      'appdocker01',
    );
    await screen.findByTestId('engine-confirm');
    expect(screen.queryByTestId('engine-confirm-input')).toBeNull();
    fireEvent.click(screen.getByTestId('engine-confirm-ok'));
    expect(await answer).toBe('31914983424');
  });

  it('Cancel answers null', async () => {
    render(() => <EngineConfirmDialog />);
    const answer = requestEngineConfirm(req({}), 'appdocker01');
    fireEvent.click(await screen.findByTestId('engine-confirm-cancel'));
    expect(await answer).toBeNull();
  });
});
