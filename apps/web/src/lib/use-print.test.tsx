import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { usePrint } from './use-print.js';

function Sheet({ ready }: { ready: boolean }) {
  const sheet = usePrint(ready);
  return (
    <>
      <button type="button" onClick={sheet.print}>
        Print
      </button>
      <button type="button" onClick={sheet.toggle}>
        Preview
      </button>
      {sheet.shown ? <p>the document</p> : null}
    </>
  );
}

describe('printing a document', () => {
  it('shows the document and opens the print dialog, rather than only showing it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Sheet ready />);

    await user.click(screen.getByRole('button', { name: 'Print' }));
    expect(screen.getByText('the document')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
    vi.useRealTimers();
  });

  it('waits for the letterhead before printing, so the page is not blank', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rerender } = render(<Sheet ready={false} />);

    await user.click(screen.getByRole('button', { name: 'Print' }));
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(print).not.toHaveBeenCalled();

    rerender(<Sheet ready />);
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
    vi.useRealTimers();
  });

  it('previews without printing', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<Sheet ready />);

    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByText('the document')).toBeInTheDocument();
    expect(print).not.toHaveBeenCalled();
    print.mockRestore();
  });
});
