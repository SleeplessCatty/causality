import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { ApiClientError } from '../../shared/api/httpClient';
import { AppDialog } from '../../shared/dialog/AppDialog';
import { useAutoDismissError } from '../../shared/forms/useAutoDismissError';
import { getMcpSettings, rotateMcpToken } from './parameterSettingsApi';

const mcpSettingsQueryKey = ['mcp', 'settings'] as const;

function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.details.message;
  if (error instanceof Error) return error.message;
  return '操作失败，请稍后重试';
}

export function McpSettingsPanel() {
  const queryClient = useQueryClient();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const [tokenVisible, setTokenVisible] = useState(false);
  const [rotationOpen, setRotationOpen] = useState(false);
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

  function reportError(error: unknown): void {
    setActionError(actionErrorMessage(error));
    setErrorRevision((revision) => revision + 1);
  }

  const rotation = useMutation({
    mutationFn: rotateMcpToken,
    onSuccess: (result) => {
      queryClient.setQueryData(mcpSettingsQueryKey, result.settings);
      setRotationOpen(false);
      setActionError(undefined);
      void queryClient.invalidateQueries({ queryKey: mcpSettingsQueryKey });
    },
    onError: reportError,
  });

  async function copyClientConfiguration(): Promise<void> {
    if (!settings.data) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(settings.data.clientConfig, null, 2));
      setCopied(true);
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
            <p>供本机 AI 客户端连接 Causality，并执行查询、方案生成和确认入库流程。</p>
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
            <dl className="mcp-settings-details">
              <div>
                <dt>状态</dt>
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
                <dt>访问令牌</dt>
                <dd>
                  <code title={tokenVisible ? current.accessToken : current.maskedToken}>
                    {tokenVisible ? current.accessToken : current.maskedToken}
                  </code>
                </dd>
              </div>
            </dl>

            <div className="mcp-settings-actions">
              {actionError && !rotationOpen ? (
                <div className="form-alert mcp-settings-alert" role="alert">
                  {actionError}
                </div>
              ) : null}
              {copied ? (
                <span className="mcp-settings-copy-status" role="status">
                  客户端配置已复制
                </span>
              ) : null}
              <button
                className="button button--secondary"
                type="button"
                onClick={() => setTokenVisible((visible) => !visible)}
              >
                {tokenVisible ? '隐藏访问令牌' : '显示访问令牌'}
              </button>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => void copyClientConfiguration()}
              >
                复制客户端配置
              </button>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => {
                  setActionError(undefined);
                  setRotationOpen(true);
                }}
              >
                重新生成令牌
              </button>
            </div>
          </>
        )}
      </section>

      <AppDialog
        open={rotationOpen}
        title="重新生成 MCP 访问令牌"
        descriptionId="mcp-token-rotation-description"
        pending={rotation.isPending}
        initialFocusRef={cancelButtonRef}
        className="mcp-token-dialog"
        onClose={() => {
          setRotationOpen(false);
          setActionError(undefined);
        }}
        actions={
          <>
            <button
              ref={cancelButtonRef}
              className="button button--secondary"
              type="button"
              disabled={rotation.isPending}
              onClick={() => {
                setRotationOpen(false);
                setActionError(undefined);
              }}
            >
              取消
            </button>
            <button
              className="button button--primary"
              type="button"
              disabled={rotation.isPending}
              onClick={() => rotation.mutate()}
            >
              {rotation.isPending ? '正在重新生成…' : '确认重新生成'}
            </button>
          </>
        }
      >
        <p id="mcp-token-rotation-description">
          重新生成后，当前令牌立即失效，现有客户端将断开，需要使用新令牌重新配置。
        </p>
        {actionError ? (
          <div className="form-alert delete-dialog__error" role="alert">
            {actionError}
          </div>
        ) : null}
      </AppDialog>
    </>
  );
}
