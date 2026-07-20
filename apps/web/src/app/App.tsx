import { SystemStatus } from '../features/system-status/SystemStatus';

export function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="/" aria-label="Causality 首页">
          <span className="brand-mark" aria-hidden="true">
            C
          </span>
          <span>Causality</span>
        </a>
        <span className="environment-label">Foundation</span>
      </header>

      <main>
        <section className="hero" aria-labelledby="page-title">
          <p className="eyebrow">CAUSAL KNOWLEDGE SYSTEM</p>
          <h1 id="page-title">金融因果知识库</h1>
          <p>记录事件、因果关系与验证依据，构建可持续维护的金融因果知识。</p>
        </section>
        <SystemStatus />
      </main>
    </div>
  );
}
