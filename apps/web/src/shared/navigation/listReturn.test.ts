import { describe, expect, it } from 'vitest';

import {
  buildListPath,
  createListReturnState,
  getListFocusId,
  resolveListReturnPath,
} from './listReturn';

describe('list return navigation', () => {
  it('preserves the current list query and record id', () => {
    const state = createListReturnState(
      { pathname: '/events', search: '?q=%E5%8E%9F%E6%B2%B9&page=3' },
      '11111111-1111-4111-8111-111111111111',
    );

    expect(state).toEqual({
      listReturnPath: '/events?q=%E5%8E%9F%E6%B2%B9&page=3',
      listFocusId: '11111111-1111-4111-8111-111111111111',
    });
    expect(resolveListReturnPath(state, '/events', 1)).toBe('/events?q=%E5%8E%9F%E6%B2%B9&page=3');
    expect(getListFocusId(state)).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('uses the server-provided page for direct entry and rejects another resource path', () => {
    expect(buildListPath('/cases', 4)).toBe('/cases?page=4');
    expect(buildListPath('/cases', 1)).toBe('/cases');
    expect(resolveListReturnPath({ listReturnPath: '/events?page=9' }, '/cases', 4)).toBe(
      '/cases?page=4',
    );
    expect(resolveListReturnPath(null, '/cases', 4)).toBe('/cases?page=4');
  });
});
