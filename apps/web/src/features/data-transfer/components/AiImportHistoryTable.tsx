import type { AiImportBatchListResponse, AiImportBatchSummary } from '@causality/contracts';
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
              <th scope="col">原子事件</th>
              <th scope="col">具体案例</th>
              <th scope="col">因果关系</th>
              <th scope="col">案例关联</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((batch) => {
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
                    新增 {batch.counts.eventCreated} / 复用 {batch.counts.eventReused} / 更新{' '}
                    {batch.counts.eventUpdated}
                  </td>
                  <td>
                    新增 {batch.counts.caseCreated} / 复用 {batch.counts.caseReused}
                  </td>
                  <td>
                    新增 {batch.counts.relationCreated} / 复用 {batch.counts.relationReused}
                  </td>
                  <td>
                    新增 {batch.counts.relationCaseCreated} / 复用 {batch.counts.relationCaseReused}
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
