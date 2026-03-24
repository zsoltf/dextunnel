export const APP_SERVER_RPC_METHODS = [
  "thread/list",
  "thread/read",
  "thread/resume",
  "thread/start",
  "turn/start",
  "turn/steer",
  "turn/interrupt"
];

export const APP_SERVER_NOTIFICATION_METHODS = [
  "thread/status/changed",
  "thread/name/updated",
  "thread/tokenUsage/updated",
  "turn/started",
  "turn/completed",
  "item/completed",
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "item/tool/requestUserInput",
  "item/tool/call",
  "mcpServer/elicitation/request"
];

export const APP_SERVER_LIVE_PATCH_NOTIFICATION_METHODS = [
  "thread/status/changed",
  "thread/name/updated",
  "thread/tokenUsage/updated",
  "turn/started",
  "turn/completed",
  "turn/plan/updated",
  "turn/diff/updated",
  "item/started",
  "item/completed",
  "item/agentMessage/delta",
  "item/plan/delta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/fileChange/outputDelta",
  "thread/compacted"
];

export const APP_SERVER_SERVER_REQUEST_METHODS = [
  "account/chatgptAuthTokens/refresh",
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
  "item/tool/call"
];

export const APP_SERVER_ITEM_TYPES = [
  "userMessage",
  "agentMessage",
  "commandExecution",
  "reasoning",
  "contextCompaction",
  "mcpToolCall",
  "dynamicToolCall",
  "collabToolCall",
  "fileChange"
];

export const APP_SERVER_DRIFT_RUNBOOK_PATH = ".maintainer/ops/app-server-drift-runbook.md";
