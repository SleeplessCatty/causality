import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WindowedListbox } from './WindowedListbox';

describe('WindowedListbox', () => {
  it('renders the active range instead of every logical option', async () => {
    render(
      <WindowedListbox
        id="candidate-list"
        itemCount={1_000}
        itemHeight={36}
        activeIndex={500}
        renderOption={(index, style) => (
          <button role="option" style={style} aria-selected={index === 500}>
            候选 {index}
          </button>
        )}
      />,
    );

    expect(await screen.findByRole('option', { name: '候选 500' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: '候选 0' })).toBeNull();
    expect(screen.getAllByRole('option').length).toBeLessThan(30);
  });

  it('updates the rendered range when the list scrolls', async () => {
    render(
      <WindowedListbox
        id="candidate-list"
        itemCount={100}
        itemHeight={40}
        activeIndex={-1}
        renderOption={(index, style) => (
          <button role="option" style={style} aria-selected="false">
            候选 {index}
          </button>
        )}
      />,
    );

    const listbox = screen.getByRole('listbox');
    Object.defineProperty(listbox, 'scrollTop', { configurable: true, value: 2_000 });
    fireEvent.scroll(listbox);
    await waitFor(() => expect(screen.getByRole('option', { name: '候选 50' })).toBeTruthy());
    expect(screen.queryByRole('option', { name: '候选 0' })).toBeNull();
  });
});
