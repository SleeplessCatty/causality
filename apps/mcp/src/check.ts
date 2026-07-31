import { loadMcpCheckOptions } from './config/checkConfig.js';
import { renderMcpCheckText, runMcpCheck } from './diagnostics/mcpCheck.js';

const helpText = `Causality MCP 只读兼容性检查

用法：pnpm mcp:check -- [选项]

选项：
  --transport=streamable-http|stdio  选择传输方式，默认 streamable-http
  --json                             仅向 stdout 输出 JSON 报告
  --config=<path>                    读取本地 URL 与 Token 配置
  --help                             显示帮助

HTTP Token 只能通过 CAUSALITY_MCP_CHECK_TOKEN 或配置文件提供。`;

async function main(): Promise<void> {
  try {
    const options = await loadMcpCheckOptions();
    if (options.help) {
      process.stdout.write(`${helpText}\n`);
      return;
    }
    const report = await runMcpCheck(options);
    process.stdout.write(
      `${options.json ? JSON.stringify(report, null, 2) : renderMcpCheckText(report)}\n`,
    );
    if (!report.success) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(
      `MCP 检查无法启动：${error instanceof Error ? error.message : '未知错误'}\n`,
    );
    process.exitCode = 1;
  }
}

await main();
