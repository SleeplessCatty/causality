import type { ImportBatchListResponse, ImportBatchSummary } from '@causality/contracts';
import { Link, type Location } from 'react-router';

import { scrollMainContentToTop } from '../../../app/scrollMainContentToTop';
import { createListReturnState } from '../../../shared/navigation/listReturn';
import { listRecordDomId } from '../../../shared/navigation/useListRecordFocus';
import { ListPagination } from '../../../shared/pagination/ListPagination';
import { OverflowText } from '../../../shared/tooltip/OverflowText';

interface ImportHistoryTableProps {
  data: ImportBatchListResponse;
  fetching: boolean;
  location: Location;
  onPageChange(page: number): void;
}

const completedAtFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const typeLabels = {
  event: '原子事件',
  case: '具体案例',
  relation: '因果关系',
  relation_case: '案例关联',
} as const;

function formatCounts(counts: { created: number; reused: number }): string {
  return counts.created === 0 && counts.reused === 0
    ? '—'
    : `新增 ${counts.created} / 复用 ${counts.reused}`;
}

function detailPath(batch: ImportBatchSummary): string {
  return `/data-transfer/imports/${batch.id}?tab=events&eventPage=1&casePage=1&relationPage=1&relationCasePage=1`;
}

export function ImportHistoryTable({
  data,
  fetching,
  location,
  onPageChange,
}: ImportHistoryTableProps) {
  if (data.items.length === 0) {
    return (
      <div className="table-state table-state--empty data-transfer-history-empty">
        <strong>还没有导入记录</strong>
        <span>选择 CSV 文件并完成导入后，记录会显示在这里。</span>
      </div>
    );
  }

  return (
    <>
      <div className="event-table-wrap data-transfer-table-wrap">
        <table className="event-table data-transfer-history-table">
          <thead>
            <tr>
              <th scope="col">完成时间</th>
              <th scope="col">文件名</th>
              <th scope="col">导入类型</th>
              <th scope="col">原子事件</th>
              <th scope="col">具体案例</th>
              <th scope="col">因果关系</th>
              <th scope="col">案例关联</th>
              <th scope="col">查看详情</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((batch) => {
              const typeSummary = batch.recordTypes.map((type) => typeLabels[type]).join('、');
              return (
                <tr key={batch.id} id={listRecordDomId(batch.id)}>
                  <td>
                    <time dateTime={batch.completedAt}>
                      {completedAtFormatter.format(new Date(batch.completedAt))}
                    </time>
                  </td>
                  <td>
                    <OverflowText content={batch.filename} mode="always">
                      <span>{batch.filename}</span>
                    </OverflowText>
                  </td>
                  <td>
                    <OverflowText content={typeSummary} mode="always">
                      <span>{typeSummary}</span>
                    </OverflowText>
                  </td>
                  <td>{formatCounts(batch.counts.event)}</td>
                  <td>{formatCounts(batch.counts.case)}</td>
                  <td>{formatCounts(batch.counts.relation)}</td>
                  <td>{formatCounts(batch.counts.relationCase)}</td>
                  <td>
                    <Link
                      className="text-button"
                      to={detailPath(batch)}
                      state={createListReturnState(location, batch.id)}
                      aria-label="查看导入详情"
                    >
                      查看详情
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ListPagination
        page={data.page}
        totalPages={data.totalPages}
        totalItems={data.totalItems}
        disabled={fetching}
        onPageChange={onPageChange}
        onNavigate={scrollMainContentToTop}
      />
    </>
  );
}
