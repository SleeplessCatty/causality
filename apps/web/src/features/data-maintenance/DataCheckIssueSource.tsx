import { Link } from 'react-router';

import type { DataCheckIssueSource as DataCheckIssueSourceValue } from '@causality/contracts';
import { OverflowText } from '../../shared/tooltip/OverflowText';

type SourceItem = DataCheckIssueSourceValue['items'][number];

function SourceText({ item, className }: { item: SourceItem; className?: string }) {
  const combinedClassName = ['data-check-source__text', className].filter(Boolean).join(' ');
  return (
    <OverflowText content={item.label} mode="always">
      {item.detailPath ? (
        <Link className={combinedClassName} to={item.detailPath}>
          {item.label}
        </Link>
      ) : (
        <span
          className={`${combinedClassName}${
            item.type === 'missing' ? ' data-check-source__missing' : ''
          }`}
        >
          {item.label}
        </span>
      )}
    </OverflowText>
  );
}

function AuxiliaryText({ text }: { text: string }) {
  return (
    <OverflowText content={text} mode="always">
      <span className="data-check-source__auxiliary">{text}</span>
    </OverflowText>
  );
}

function SingleSource({ source }: { source: DataCheckIssueSourceValue }) {
  return <SourceText item={source.items[0]!} />;
}

function PairSource({ source }: { source: DataCheckIssueSourceValue }) {
  return (
    <div className="data-check-source__line data-check-source__pair">
      {source.items.map((item, index) => (
        <span className="data-check-source__segment" key={`${item.role}-${index}`}>
          {index > 0 ? <span className="data-check-source__separator">↔</span> : null}
          <SourceText item={item} />
        </span>
      ))}
    </div>
  );
}

function RelationLinks({ paths }: { paths: readonly string[] }) {
  if (paths.length === 0) return <span className="data-check-source__arrow">→</span>;
  if (paths.length === 1) {
    return (
      <OverflowText content="查看因果关系详情" mode="always">
        <Link
          className="data-check-source__arrow data-check-source__arrow-link"
          to={paths[0]!}
          aria-label="查看因果关系详情"
        >
          →
        </Link>
      </OverflowText>
    );
  }
  return (
    <span className="data-check-source__relation-links">
      <span className="data-check-source__arrow">→</span>
      {paths.map((path, index) => {
        const label = `关系 ${String.fromCharCode(65 + index)}`;
        return (
          <OverflowText content={label} mode="always" key={path}>
            <Link className="data-check-source__relation-link" to={path}>
              {label}
            </Link>
          </OverflowText>
        );
      })}
    </span>
  );
}

function RelationSource({ source }: { source: DataCheckIssueSourceValue }) {
  const cause = source.items.find((item) => item.role === 'cause') ?? source.items[0]!;
  const effect = source.items.find((item) => item.role === 'effect') ?? source.items[1]!;
  return (
    <div className="data-check-source__line data-check-source__relation">
      <SourceText item={cause} />
      <RelationLinks paths={source.relationDetailPaths} />
      <SourceText item={effect} />
    </div>
  );
}

function OwnedValueSource({ source }: { source: DataCheckIssueSourceValue }) {
  const owner = source.items.find((item) => item.role === 'owner') ?? source.items[0]!;
  const value = source.items.find((item) => item.role === 'value') ?? source.items[1]!;
  return (
    <div className="data-check-source__line data-check-source__owned-value">
      <SourceText item={owner} />
      <span className="data-check-source__separator">·</span>
      <SourceText item={value} />
    </div>
  );
}

function BrokenReferenceSource({ source }: { source: DataCheckIssueSourceValue }) {
  return (
    <div className="data-check-source__stack">
      <div className="data-check-source__line">
        {source.items.map((item, index) => (
          <span className="data-check-source__segment" key={`${item.role}-${index}`}>
            {index > 0 ? <span className="data-check-source__separator">·</span> : null}
            <SourceText item={item} />
          </span>
        ))}
      </div>
      {source.auxiliaryText ? <AuxiliaryText text={source.auxiliaryText} /> : null}
    </div>
  );
}

export function DataCheckIssueSource({ source }: { source: DataCheckIssueSourceValue }) {
  let content;
  switch (source.displayKind) {
    case 'single':
      content = <SingleSource source={source} />;
      break;
    case 'pair':
      content = <PairSource source={source} />;
      break;
    case 'relation':
      content = <RelationSource source={source} />;
      break;
    case 'owned_value':
      content = <OwnedValueSource source={source} />;
      break;
    case 'broken_reference':
      content = <BrokenReferenceSource source={source} />;
      break;
  }
  return <div className="data-check-source">{content}</div>;
}
