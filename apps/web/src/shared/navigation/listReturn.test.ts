import { describe, expect, it } from 'vitest';

import {
  buildListPath,
  createDataCheckEditReturnState,
  createListReturnState,
  getListFocusId,
  resolveRecordReturnTarget,
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

  it('creates a maintenance edit return and distinguishes cancel from one-time saved recheck', () => {
    const state = createDataCheckEditReturnState(
      {
        pathname: '/maintenance',
        search: '?page=2&severity=warning&issue=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );

    expect(state).toEqual({
      dataCheckReturnPath:
        '/maintenance?page=2&severity=warning&issue=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      dataCheckSnapshotId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      dataCheckIssueId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      dataCheckReturnMode: 'cancel',
    });
    expect(resolveRecordReturnTarget(state, '/events', 4)).toEqual({
      path: state.dataCheckReturnPath,
      dataCheck: {
        snapshotId: state.dataCheckSnapshotId,
        issueId: state.dataCheckIssueId,
        recheck: false,
      },
    });
    expect(
      resolveRecordReturnTarget({ ...state, dataCheckReturnMode: 'saved' }, '/events', 4),
    ).toEqual({
      path: `${state.dataCheckReturnPath}&recheck=1`,
      dataCheck: {
        snapshotId: state.dataCheckSnapshotId,
        issueId: state.dataCheckIssueId,
        recheck: true,
      },
    });
  });

  it.each([
    'https://evil.example/maintenance',
    '//evil.example/maintenance',
    '%2F%2Fevil.example/maintenance',
    '/%2F%2Fevil.example/maintenance',
    '/events/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '/cases?page=9',
  ])('rejects unsafe or unrelated data-check return path %s', (dataCheckReturnPath) => {
    const target = resolveRecordReturnTarget(
      {
        dataCheckReturnPath,
        dataCheckSnapshotId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        dataCheckIssueId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        dataCheckReturnMode: 'saved',
      },
      '/events',
      4,
    );

    expect(target).toEqual({ path: '/events?page=4' });
  });

  it('preserves a valid matching business-list return when no maintenance return is present', () => {
    expect(
      resolveRecordReturnTarget(
        { listReturnPath: '/relations?q=%E5%85%B3%E7%A8%8E&page=2' },
        '/relations',
        1,
      ),
    ).toEqual({ path: '/relations?q=%E5%85%B3%E7%A8%8E&page=2' });
  });
});
