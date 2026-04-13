import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import ChangeEngineDialog from '../components/ChangeEngineDialog';

vi.mock('../store/storage', () => ({
  readEngineHistory: vi.fn(() => Promise.resolve([])),
  addToEngineHistory: vi.fn(() => Promise.resolve()),
  csSet: vi.fn(() => Promise.resolve()),
  STORAGE_KEY_DEMO: 'demoMode',
}));

vi.mock('../store/discovery', () => ({
  discoverAllEngines: vi.fn(() => Promise.resolve([])),
}));

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no fetch'))));

import { readEngineHistory } from '../store/storage';

const defaultProps = () => ({
  currentHostname: 'appdocker01.local',
  onConnect: vi.fn(),
  onDemoMode: vi.fn(),
  onCancel: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readEngineHistory).mockResolvedValue([]);
});

describe('ChangeEngineDialog', () => {
  it('renders hostname input', () => {
    render(() => <ChangeEngineDialog {...defaultProps()} />);
    expect(screen.getByPlaceholderText(/Engine name/i)).toBeInTheDocument();
  });

  it('renders Connect button disabled when input is empty', () => {
    render(() => <ChangeEngineDialog {...defaultProps()} />);
    // The Connect button in the input row (not the ones in suggestions)
    const btn = screen.getByRole('button', { name: /^connect$/i });
    expect(btn).toBeDisabled();
  });

  it('shows history items when available', async () => {
    vi.mocked(readEngineHistory).mockResolvedValue(['appdocker01', 'appdocker02']);
    render(() => <ChangeEngineDialog {...defaultProps()} />);
    await waitFor(() => {
      expect(screen.getByText('appdocker01')).toBeInTheDocument();
      expect(screen.getByText('appdocker02')).toBeInTheDocument();
    });
  });

  it('hides history when user starts typing', async () => {
    vi.mocked(readEngineHistory).mockResolvedValue(['appdocker01']);
    render(() => <ChangeEngineDialog {...defaultProps()} />);
    await waitFor(() => {
      expect(screen.getByText('appdocker01')).toBeInTheDocument();
    });
    const input = screen.getByPlaceholderText(/Engine name/i);
    fireEvent.input(input, { target: { value: 'something' } });
    expect(screen.queryByText('appdocker01')).not.toBeInTheDocument();
  });

  it('calls onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn();
    render(() => <ChangeEngineDialog {...defaultProps()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel when backdrop is clicked', () => {
    const onCancel = vi.fn();
    render(() => <ChangeEngineDialog {...defaultProps()} onCancel={onCancel} />);
    const backdrop = document.querySelector('.change-engine-dialog')!;
    fireEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('shows demo mode button', () => {
    render(() => <ChangeEngineDialog {...defaultProps()} />);
    expect(screen.getByRole('button', { name: /demo mode/i })).toBeInTheDocument();
  });

  it('shows scan network button', () => {
    render(() => <ChangeEngineDialog {...defaultProps()} />);
    expect(screen.getByRole('button', { name: /scan network/i })).toBeInTheDocument();
  });

  it('enables Connect button when input has text', () => {
    render(() => <ChangeEngineDialog {...defaultProps()} />);
    const input = screen.getByPlaceholderText(/Engine name/i);
    fireEvent.input(input, { target: { value: 'appdocker01' } });
    const btn = screen.getByRole('button', { name: /^connect$/i });
    expect(btn).not.toBeDisabled();
  });

  it('shows error when connection fails', async () => {
    render(() => <ChangeEngineDialog {...defaultProps()} />);
    const input = screen.getByPlaceholderText(/Engine name/i);
    fireEvent.input(input, { target: { value: 'appdocker01' } });
    fireEvent.click(screen.getByRole('button', { name: /^connect$/i }));
    await waitFor(() => {
      expect(screen.getByText(/Could not reach/i)).toBeInTheDocument();
    });
  });
});
