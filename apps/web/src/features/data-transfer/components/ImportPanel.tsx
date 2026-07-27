import type { ChangeEvent } from 'react';

interface ImportPanelProps {
  file: File | null;
  pending: boolean;
  error: string | null;
  onFileChange(file: File | null): void;
  onSubmit(): void;
}

const megabyteFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatFileSize(bytes: number): string {
  return `${megabyteFormatter.format(bytes / (1024 * 1024))} MB`;
}

export function ImportPanel({ file, pending, error, onFileChange, onSubmit }: ImportPanelProps) {
  function selectFile(event: ChangeEvent<HTMLInputElement>): void {
    onFileChange(event.target.files?.[0] ?? null);
  }

  return (
    <section className="data-transfer-import-card" aria-labelledby="import-panel-title">
      <div className="data-transfer-section-heading">
        <div>
          <h2 id="import-panel-title">导入 CSV</h2>
          <p>逐条解析有效记录，已有数据仅复用，不修改。</p>
        </div>
      </div>
      <div className="data-transfer-import-controls">
        <label className="button button--secondary data-transfer-file-button">
          选择文件
          <input
            className="sr-only"
            type="file"
            accept=".csv,text/csv"
            aria-label="选择 CSV 文件"
            disabled={pending}
            onChange={selectFile}
          />
        </label>
        <div className="data-transfer-selected-file" aria-live="polite">
          {file ? (
            <>
              <strong>{file.name}</strong>
              <span>{formatFileSize(file.size)}</span>
            </>
          ) : (
            <span>尚未选择 CSV 文件</span>
          )}
        </div>
        <button
          className="button button--primary"
          type="button"
          disabled={!file || pending}
          onClick={onSubmit}
        >
          {pending ? '正在导入…' : '开始导入'}
        </button>
      </div>
      {error ? (
        <div className="form-alert data-transfer-import-error" role="alert">
          {error}
        </div>
      ) : null}
      <p className="data-transfer-import-note">
        支持最大 20 MB、最多 50,000 条逻辑记录；字段必须使用双引号包裹。
      </p>
    </section>
  );
}
