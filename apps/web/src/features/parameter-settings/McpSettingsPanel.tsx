import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { ApiClientError } from '../../shared/api/httpClient';
import { AppDialog } from '../../shared/dialog/AppDialog';
import { useAutoDismissError } from '../../shared/forms/useAutoDismissError';
import { OverflowText } from '../../shared/tooltip/OverflowText';
import {
  createMcpToken,
  deleteMcpToken,
  getMcpSettings,
  getMcpTokenSecret,
  listMcpTokens,
} from './parameterSettingsApi';

const mcpSettingsQueryKey = ['mcp', 'settings'] as const;
const mcpTokensQueryKey = ['mcp', 'tokens'] as const;
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.details.message;
  if (error instanceof Error) return error.message;
  return '操作失败，请稍后重试';
}

function formatLastUsed(value: string | null): string {
  return value ? dateFormatter.format(new Date(value)) : '从未';
}

function createClientConfiguration(endpoint: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        causality: {
          transport: 'streamable-http',
          url: endpoint,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

export function McpSettingsPanel() {
  const queryClient = useQueryClient();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [tokenName, setTokenName] = useState('');
  const [revealedTokens, setRevealedTokens] = useState<Record<string, string>>({});
  const [deleteToken, setDeleteToken] = useState<{ id: string; name: string }>();
  const [secretPendingId, setSecretPendingId] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [errorRevision, setErrorRevision] = useState(0);
  const [copyNotice, setCopyNotice] = useState<'token' | 'json'>();

  useAutoDismissError(Boolean(actionError), errorRevision, () => setActionError(undefined));
  useEffect(() => {
    if (!copyNotice) return;
    const timeout = window.setTimeout(() => setCopyNotice(undefined), 2_000);
    return () => window.clearTimeout(timeout);
  }, [copyNotice]);

  const settings = useQuery({
    queryKey: mcpSettingsQueryKey,
    queryFn: ({ signal }) => getMcpSettings(signal),
    refetchOnWindowFocus: true,
  });
  const tokens = useQuery({
    queryKey: mcpTokensQueryKey,
    queryFn: ({ signal }) => listMcpTokens(signal),
  });

  function reportError(error: unknown): void {
    setActionError(actionErrorMessage(error));
    setErrorRevision((revision) => revision + 1);
  }

  const create = useMutation({
    mutationFn: () => createMcpToken(tokenName),
    onSuccess: () => {
      setCreateOpen(false);
      setTokenName('');
      setActionError(undefined);
      void queryClient.invalidateQueries({ queryKey: mcpTokensQueryKey });
    },
    onError: reportError,
  });
  const remove = useMutation({
    mutationFn: deleteMcpToken,
    onSuccess: () => {
      setActionError(undefined);
      void queryClient.invalidateQueries({ queryKey: mcpTokensQueryKey });
    },
    onError: reportError,
  });

  async function readSecret(tokenId: string): Promise<string | undefined> {
    setSecretPendingId(tokenId);
    try {
      const secret = await getMcpTokenSecret(tokenId);
      setActionError(undefined);
      return secret.token;
    } catch (error) {
      reportError(error);
      return undefined;
    } finally {
      setSecretPendingId(undefined);
    }
  }

  async function toggleReveal(tokenId: string): Promise<void> {
    if (revealedTokens[tokenId]) {
      setRevealedTokens((current) => {
        const next = { ...current };
        delete next[tokenId];
        return next;
      });
      return;
    }
    const secret = await readSecret(tokenId);
    if (secret) setRevealedTokens((current) => ({ ...current, [tokenId]: secret }));
  }

  async function copySecret(tokenId: string, format: 'token' | 'json'): Promise<void> {
    const secret = await readSecret(tokenId);
    if (!secret) return;
    try {
      const value =
        format === 'token'
          ? secret
          : createClientConfiguration(settings.data?.endpoint ?? '', secret);
      await navigator.clipboard.writeText(value);
      setCopyNotice(format);
      setActionError(undefined);
    } catch (error) {
      reportError(error);
    }
  }

  const current = settings.data;

  return (
    <>
      <section className="mcp-settings-section" aria-labelledby="mcp-settings-title">
        <div className="semantic-settings-section__heading">
          <div>
            <h2 id="mcp-settings-title">MCP 服务</h2>
            <p>查看服务状态，管理个人令牌并获取客户端配置说明。</p>
          </div>
        </div>
        {settings.isPending ? (
          <div className="mcp-settings-state" role="status">
            正在读取 MCP 服务配置…
          </div>
        ) : settings.isError || !current ? (
          <div className="mcp-settings-state mcp-settings-state--error">
            <span>无法读取 MCP 服务配置</span>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => void settings.refetch()}
            >
              重新加载
            </button>
          </div>
        ) : (
          <>
            <section className="mcp-settings-block" aria-labelledby="mcp-overview-title">
              <div className="mcp-settings-block__heading">
                <h3 id="mcp-overview-title">服务概览</h3>
              </div>
              <dl className="mcp-settings-details">
                <div>
                  <dt>运行状态</dt>
                  <dd>
                    <span
                      className={[
                        'mcp-settings-status',
                        current.serviceStatus === 'running'
                          ? 'mcp-settings-status--running'
                          : 'mcp-settings-status--stopped',
                      ].join(' ')}
                    >
                      {current.serviceStatus === 'running' ? '运行中' : '未运行'}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>连接地址</dt>
                  <dd>
                    <code title={current.endpoint}>{current.endpoint}</code>
                  </dd>
                </div>
                <div>
                  <dt>服务能力</dt>
                  <dd>
                    <ul className="mcp-settings-capabilities" aria-label="服务能力">
                      <li>
                        <strong>15</strong>
                        <span>Tool</span>
                      </li>
                      <li>
                        <strong>5</strong>
                        <span>Prompt</span>
                      </li>
                      <li>
                        <strong>4</strong>
                        <span>Resource</span>
                      </li>
                    </ul>
                  </dd>
                </div>
              </dl>
            </section>
            <section className="mcp-settings-block" aria-labelledby="mcp-tokens-title">
              <div className="mcp-settings-block__heading mcp-settings-block__heading--actions">
                <div>
                  <h3 id="mcp-tokens-title">个人令牌管理</h3>
                  <p>令牌默认隐藏，可按需查看、复制或撤销。</p>
                </div>
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => {
                    setActionError(undefined);
                    setTokenName('');
                    setCreateOpen(true);
                  }}
                >
                  创建个人令牌
                </button>
              </div>
              {actionError && !createOpen && !deleteToken ? (
                <div className="form-alert mcp-settings-alert" role="alert">
                  {actionError}
                </div>
              ) : null}
              {copyNotice ? (
                <span className="mcp-settings-copy-status" role="status">
                  {copyNotice === 'token' ? '令牌已复制' : 'JSON 配置已复制'}
                </span>
              ) : null}
              {tokens.isPending ? (
                <div className="mcp-settings-table-state" role="status">
                  正在读取令牌…
                </div>
              ) : (
                <table className="mcp-settings-token-table">
                  <thead>
                    <tr>
                      <th>令牌名称</th>
                      <th>令牌</th>
                      <th>最近使用时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokens.data?.map((token) => {
                      const revealed = revealedTokens[token.id];
                      const displayedToken = revealed ?? token.maskedToken;
                      const pending = secretPendingId === token.id;
                      return (
                        <tr key={token.id}>
                          <td>
                            <OverflowText content={token.name} mode="always">
                              <span className="mcp-settings-token-name">{token.name}</span>
                            </OverflowText>
                          </td>
                          <td>
                            <OverflowText content={displayedToken} mode="always">
                              <code className="mcp-settings-token-value">{displayedToken}</code>
                            </OverflowText>
                          </td>
                          <td>{formatLastUsed(token.lastUsedAt)}</td>
                          <td>
                            <div className="mcp-token-row-actions">
                              <button
                                className="mcp-token-row-action"
                                type="button"
                                disabled={pending}
                                onClick={() => void toggleReveal(token.id)}
                              >
                                {revealed ? '隐藏' : '查看'}
                              </button>
                              <button
                                className="mcp-token-row-action"
                                type="button"
                                disabled={pending}
                                onClick={() => void copySecret(token.id, 'token')}
                              >
                                复制令牌
                              </button>
                              <button
                                className="mcp-token-row-action"
                                type="button"
                                disabled={pending}
                                onClick={() => void copySecret(token.id, 'json')}
                              >
                                复制完整 JSON 配置
                              </button>
                              <button
                                className="mcp-token-row-action mcp-token-row-action--danger"
                                type="button"
                                disabled={remove.isPending}
                                onClick={() => {
                                  setActionError(undefined);
                                  setDeleteToken({ id: token.id, name: token.name });
                                }}
                              >
                                撤销
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
            <section className="mcp-settings-block" aria-labelledby="mcp-client-help-title">
              <div className="mcp-settings-block__heading">
                <h3 id="mcp-client-help-title">客户端配置说明</h3>
              </div>
              <p className="mcp-settings-help">
                请在支持手工 Bearer Token 配置的客户端中使用个人令牌；不支持 OAuth discovery 或仅
                OAuth 的客户端。
              </p>
            </section>
          </>
        )}
      </section>
      <AppDialog
        open={createOpen}
        title="创建 MCP 个人令牌"
        descriptionId="mcp-token-create-description"
        pending={create.isPending}
        initialFocusRef={cancelButtonRef}
        className="mcp-token-dialog"
        onClose={() => {
          if (!create.isPending) setCreateOpen(false);
        }}
        actions={
          <>
            <button
              ref={cancelButtonRef}
              className="button button--secondary"
              type="button"
              disabled={create.isPending}
              onClick={() => setCreateOpen(false)}
            >
              取消
            </button>
            <button
              className="button button--primary"
              type="button"
              disabled={create.isPending || !tokenName.trim()}
              onClick={() => create.mutate()}
            >
              {create.isPending ? '正在创建…' : '创建令牌'}
            </button>
          </>
        }
      >
        {actionError ? (
          <div className="form-alert mcp-settings-alert" role="alert">
            {actionError}
          </div>
        ) : null}
        <p id="mcp-token-create-description">设置一个便于识别的令牌名称。</p>
        <label>
          令牌名称
          <input
            value={tokenName}
            maxLength={80}
            onChange={(event) => setTokenName(event.target.value)}
            autoComplete="off"
          />
        </label>
      </AppDialog>
      <AppDialog
        open={Boolean(deleteToken)}
        title="撤销 MCP 个人令牌"
        descriptionId="mcp-token-delete-description"
        pending={remove.isPending}
        initialFocusRef={cancelButtonRef}
        className="mcp-token-dialog"
        onClose={() => {
          if (!remove.isPending) setDeleteToken(undefined);
        }}
        actions={
          <>
            <button
              ref={cancelButtonRef}
              className="button button--secondary"
              type="button"
              disabled={remove.isPending}
              onClick={() => setDeleteToken(undefined)}
            >
              取消
            </button>
            <button
              className="button button--primary"
              type="button"
              disabled={remove.isPending}
              onClick={() => {
                if (deleteToken) {
                  remove.mutate(deleteToken.id, {
                    onSuccess: () => {
                      setRevealedTokens((current) => {
                        const next = { ...current };
                        delete next[deleteToken.id];
                        return next;
                      });
                      setDeleteToken(undefined);
                    },
                  });
                }
              }}
            >
              {remove.isPending ? '正在撤销…' : '确认撤销'}
            </button>
          </>
        }
      >
        <p id="mcp-token-delete-description">
          撤销令牌“{deleteToken?.name}”后，该令牌会被永久删除，使用它的连接将在下一次请求时被拒绝。
        </p>
        {actionError ? (
          <div className="form-alert mcp-settings-alert" role="alert">
            {actionError}
          </div>
        ) : null}
      </AppDialog>
    </>
  );
}
