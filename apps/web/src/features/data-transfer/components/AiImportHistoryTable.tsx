import type {
  AiImportBatchListResponse,
  AiImportBatchSummary,
  AiImportChangeCounts,
} from '@causality/contracts';
import { Link, type Location } from 'react-router';

import { scrollMainContentToTop } from '../../../app/scrollMainContentToTop';
import { createListReturnState } from '../../../shared/navigation/listReturn';
import { listRecordDomId } from '../../../shared/navigation/useListRecordFocus';
import { ListPagination } from '../../../shared/pagination/ListPagination';
import { OverflowText } from '../../../shared/tooltip/OverflowText';

interface AiImportHistoryTableProps {
  data: AiImportBatchListResponse;
  fetching: boolean;
  location: Location;
  onPageChange(page: number): void;
}

const completedAtFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function hasBusinessChanges(counts: AiImportChangeCounts): boolean {
  return (
    counts.eventCreated > 0 ||
    counts.eventUpdated > 0 ||
    counts.caseCreated > 0 ||
    counts.relationCreated > 0 ||
    counts.relationCaseCreated > 0 ||
    counts.confidenceChanged > 0
  );
}

function formatChanges(counts: AiImportChangeCounts): string {
  return [
    `原子事件 新增 ${counts.eventCreated} / 复用 ${counts.eventReused} / 更新 ${counts.eventUpdated}`,
    `具体案例 新增 ${counts.caseCreated} / 复用 ${counts.caseReused}`,
    `因果关系 新增 ${counts.relationCreated} / 复用 ${counts.relationReused}`,
    `案例关联 ${counts.relationCaseCreated} / 置信度变化 ${counts.confidenceChanged}`,
  ].join('；');
}

function detailPath(batch: AiImportBatchSummary): string {
  return `/data-transfer/ai-imports/${batch.id}?tab=events&eventPage=1&casePage=1&relationPage=1&relationCasePage=1&confidencePage=1`;
}

export function AiImportHistoryTable({
  data,
  fetching,
  location,
  onPageChange,
}: AiImportHistoryTableProps) {
  if (data.items.length === 0) {
    return (
      <div className="table-state table-state--empty data-transfer-history-empty">
        <strong>还没有 AI 导入记录</strong>
        <span>通过 MCP 完成采集入库后，成功记录会显示在这里。</span>
      </div>
    );
  }

  return (
    <>
      <div className="event-table-wrap data-transfer-table-wrap">
        <table className="event-table data-transfer-ai-history-table">
          <thead>
            <tr>
              <th scope="col">完成时间</th>
              <th scope="col">采集主题</th>
              <th scope="col">处理结果</th>
              <th scope="col">数据变化</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((batch) => {
              const changes = formatChanges(batch.counts);
              return (
                <tr key={batch.id} id={listRecordDomId(batch.id)}>
                  <td>
                    <time dateTime={batch.completedAt}>
                      {completedAtFormatter.format(new Date(batch.completedAt))}
                    </time>
                  </td>
                  <td>
                    <OverflowText content={batch.topic} mode="always">
                      <span>{batch.topic}</span>
                    </OverflowText>
                  </td>
                  <td>
                    <span className="data-transfer-outcome data-transfer-outcome--created">
                      {hasBusinessChanges(batch.counts) ? '成功' : '成功·无变化'}
                    </span>
                  </td>
                  <td>
                    <OverflowText content={changes} mode="always">
                      <span>{changes}</span>
                    </OverflowText>
                  </td>
                  <td>
                    <Link
                      className="text-button"
                      to={detailPath(batch)}
                      state={createListReturnState(location, batch.id)}
                      aria-label="查看 AI 导入详情"
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
