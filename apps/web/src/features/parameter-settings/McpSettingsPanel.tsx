import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { ApiClientError } from '../../shared/api/httpClient';
import { AppDialog } from '../../shared/dialog/AppDialog';
import { useAutoDismissError } from '../../shared/forms/useAutoDismissError';
import { createMcpToken, getMcpSettings, listMcpTokens, revokeMcpToken } from './parameterSettingsApi';

const mcpSettingsQueryKey = ['mcp', 'settings'] as const;
const mcpTokensQueryKey = ['mcp', 'tokens'] as const;

function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.details.message;
  if (error instanceof Error) return error.message;
  return '操作失败，请稍后重试';
}

export function McpSettingsPanel() {
  const queryClient = useQueryClient();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [createdToken, setCreatedToken] = useState<string>();
  const [revokeToken, setRevokeToken] = useState<{ id: string; deviceName: string }>();
  const [actionError, setActionError] = useState<string>();
  const [errorRevision, setErrorRevision] = useState(0);
  const [copied, setCopied] = useState(false);

  useAutoDismissError(Boolean(actionError), errorRevision, () => setActionError(undefined));
  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 2_000);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const settings = useQuery({
    queryKey: mcpSettingsQueryKey,
    queryFn: ({ signal }) => getMcpSettings(signal),
    refetchOnWindowFocus: true,
  });
  const tokens = useQuery({ queryKey: mcpTokensQueryKey, queryFn: ({ signal }) => listMcpTokens(signal) });

  function reportError(error: unknown): void {
    setActionError(actionErrorMessage(error));
    setErrorRevision((revision) => revision + 1);
  }

  const create = useMutation({
    mutationFn: () => createMcpToken(deviceName),
    onSuccess: (result) => {
      setCreatedToken(result.token);
      setDeviceName('');
      setActionError(undefined);
      void queryClient.invalidateQueries({ queryKey: mcpTokensQueryKey });
    },
    onError: reportError,
  });
  const revoke = useMutation({
    mutationFn: revokeMcpToken,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: mcpTokensQueryKey }),
    onError: reportError,
  });

  async function copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setActionError(undefined);
    } catch (error) {
      reportError(error);
    }
  }

  const current = settings.data;
  const configuration = createdToken && current
    ? JSON.stringify({
        mcpServers: {
          causality: {
            transport: 'streamable-http',
            url: current.endpoint,
            headers: { Authorization: `Bearer ${createdToken}` },
          },
        },
      }, null, 2)
    : '';

  return (
    <>
      <section className="mcp-settings-section" aria-labelledby="mcp-settings-title">
        <div className="semantic-settings-section__heading">
          <div><h2 id="mcp-settings-title">MCP 服务</h2><p>个人令牌只会在创建时显示一次。</p></div>
        </div>
        {settings.isPending ? <div className="mcp-settings-state" role="status">正在读取 MCP 服务配置…</div> : settings.isError || !current ? (
          <div className="mcp-settings-state mcp-settings-state--error"><span>无法读取 MCP 服务配置</span><button className="button button--secondary" type="button" onClick={() => void settings.refetch()}>重新加载</button></div>
        ) : <>
          <dl className="mcp-settings-details">
            <div><dt>状态</dt><dd><span className={['mcp-settings-status', current.serviceStatus === 'running' ? 'mcp-settings-status--running' : 'mcp-settings-status--stopped'].join(' ')}>{current.serviceStatus === 'running' ? '运行中' : '未运行'}</span></dd></div>
            <div><dt>连接地址</dt><dd><code title={current.endpoint}>{current.endpoint}</code></dd></div>
          </dl>
          <p>MCP 提供 15 个 Tool、5 个 Prompt 和 4 个 Resource。请在支持手工 Bearer Token 配置的客户端中使用下面创建的个人令牌；不支持 OAuth discovery 或仅 OAuth 的客户端。</p>
          {actionError ? <div className="form-alert mcp-settings-alert" role="alert">{actionError}</div> : null}
          {copied ? <span className="mcp-settings-copy-status" role="status">已复制</span> : null}
          <div className="mcp-settings-actions"><button className="button button--primary" type="button" onClick={() => { setCreatedToken(undefined); setCreateOpen(true); }}>创建个人令牌</button></div>
          <h3>个人令牌</h3>
          {tokens.isPending ? <div role="status">正在读取令牌…</div> : <table><thead><tr><th>设备</th><th>最近使用</th><th>状态</th><th>操作</th></tr></thead><tbody>{tokens.data?.map((token) => <tr key={token.id}><td>{token.deviceName}</td><td>{token.lastUsedAt ?? '从未'}</td><td>{token.revokedAt ? '已撤销' : '有效'}</td><td>{token.revokedAt ? null : <button className="button button--secondary" type="button" disabled={revoke.isPending} onClick={() => setRevokeToken({ id: token.id, deviceName: token.deviceName })}>撤销</button>}</td></tr>)}</tbody></table>}
        </>}
      </section>
      <AppDialog open={createOpen} title="创建 MCP 个人令牌" descriptionId="mcp-token-create-description" pending={create.isPending} initialFocusRef={cancelButtonRef} className="mcp-token-dialog" onClose={() => { if (!create.isPending) setCreateOpen(false); }} actions={<><button ref={cancelButtonRef} className="button button--secondary" type="button" disabled={create.isPending} onClick={() => setCreateOpen(false)}>取消</button>{createdToken ? <button className="button button--primary" type="button" onClick={() => setCreateOpen(false)}>我已保存</button> : <button className="button button--primary" type="button" disabled={create.isPending || !deviceName.trim()} onClick={() => create.mutate()}>{create.isPending ? '正在创建…' : '创建令牌'}</button>}</>}>
        {createdToken ? <><p id="mcp-token-create-description">此令牌仅显示一次。关闭窗口后无法再次查看，请立即保存。</p><code className="mcp-token-once">{createdToken}</code><div className="mcp-settings-actions"><button className="button button--secondary" type="button" onClick={() => void copy(createdToken)}>复制令牌</button><button className="button button--secondary" type="button" onClick={() => void copy(configuration)}>复制完整 JSON 配置</button></div></> : <><p id="mcp-token-create-description">为此客户端设置一个容易识别的设备名称。</p><label>设备名称<input value={deviceName} maxLength={80} onChange={(event) => setDeviceName(event.target.value)} autoComplete="off" /></label></>}
      </AppDialog>
      <AppDialog open={Boolean(revokeToken)} title="撤销 MCP 个人令牌" descriptionId="mcp-token-revoke-description" pending={revoke.isPending} initialFocusRef={cancelButtonRef} className="mcp-token-dialog" onClose={() => { if (!revoke.isPending) setRevokeToken(undefined); }} actions={<><button ref={cancelButtonRef} className="button button--secondary" type="button" disabled={revoke.isPending} onClick={() => setRevokeToken(undefined)}>取消</button><button className="button button--primary" type="button" disabled={revoke.isPending} onClick={() => { if (revokeToken) revoke.mutate(revokeToken.id, { onSuccess: () => setRevokeToken(undefined) }); }}>{revoke.isPending ? '正在撤销…' : '确认撤销'}</button></>}>
        <p id="mcp-token-revoke-description">撤销“{revokeToken?.deviceName}”后，该客户端和当前会话的下一次请求将立即被拒绝。</p>
      </AppDialog>
    </>
  );
}
