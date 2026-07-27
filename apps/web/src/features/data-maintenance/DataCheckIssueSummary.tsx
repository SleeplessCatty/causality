interface DataCheckIssueSummaryProps {
  description: string;
  suggestion: string;
}

export function DataCheckIssueSummary({ description, suggestion }: DataCheckIssueSummaryProps) {
  return (
    <div className="data-check-issue-summary">
      <section>
        <h4>问题描述</h4>
        <p>{description}</p>
      </section>
      <section>
        <h4>处理建议</h4>
        <p>{suggestion}</p>
      </section>
    </div>
  );
}
