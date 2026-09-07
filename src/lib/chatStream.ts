export const EMPTY_ASSISTANT_RESPONSE =
  "模型已结束生成，但没有返回可显示的内容。请重试，或关闭深度思考后再试。";

export const STOPPED_ASSISTANT_RESPONSE = "已停止当前生成。";

export type ChatTextFields = {
  content: string;
  reasoning: string;
};

export type ChatSseEvent =
  | { kind: "ignore" }
  | { kind: "done" }
  | { kind: "payload"; payload: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Read the current vLLM reasoning field while retaining compatibility with
 * deployments that still emit the older `reasoning_content` spelling.
 */
export function extractChatTextFields(value: unknown): ChatTextFields {
  if (!isRecord(value)) {
    return { content: "", reasoning: "" };
  }

  const currentReasoning = stringField(value.reasoning);
  const legacyReasoning = stringField(value.reasoning_content);
  return {
    content: stringField(value.content),
    reasoning: currentReasoning || legacyReasoning,
  };
}

export function extractChatStreamDelta(payload: unknown): ChatTextFields {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    return { content: "", reasoning: "" };
  }
  const firstChoice = payload.choices[0];
  if (!isRecord(firstChoice)) {
    return { content: "", reasoning: "" };
  }
  return extractChatTextFields(firstChoice.delta);
}

export function extractChatMessage(payload: unknown): ChatTextFields {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    return { content: "", reasoning: "" };
  }
  const firstChoice = payload.choices[0];
  if (!isRecord(firstChoice)) {
    return { content: "", reasoning: "" };
  }
  return extractChatTextFields(firstChoice.message);
}

export function parseChatSseLine(line: string): ChatSseEvent {
  if (!line.startsWith("data:")) {
    return { kind: "ignore" };
  }

  const data = line.slice(5).trim();
  if (!data) {
    return { kind: "ignore" };
  }
  if (data === "[DONE]") {
    return { kind: "done" };
  }

  try {
    return { kind: "payload", payload: JSON.parse(data) };
  } catch {
    return { kind: "ignore" };
  }
}

export function parseThinkContent(raw: string): { think: string; main: string } {
  const open = raw.indexOf("<think>");
  if (open === -1) {
    return { think: "", main: raw };
  }
  const close = raw.indexOf("</think>", open);
  if (close === -1) {
    return { think: raw.slice(open + 7), main: raw.slice(0, open) };
  }
  return {
    think: raw.slice(open + 7, close),
    main: raw.slice(0, open) + raw.slice(close + 8),
  };
}

export class ChatStreamAccumulator {
  private rawContent = "";
  private answerContent = "";
  private reasoningContent = "";
  private taggedThinking = "";

  push(payload: unknown): ChatTextFields {
    const delta = extractChatStreamDelta(payload);
    if (delta.reasoning) {
      this.reasoningContent += delta.reasoning;
    }
    if (delta.content) {
      this.rawContent += delta.content;
      const parsed = parseThinkContent(this.rawContent);
      this.answerContent = parsed.main.trimStart() || parsed.main;
      this.taggedThinking = parsed.think;
    }
    return delta;
  }

  get content(): string {
    return this.answerContent;
  }

  get reasoning(): string {
    return this.reasoningContent;
  }

  get thinking(): string {
    return this.taggedThinking || this.reasoningContent;
  }

  visibleContent(emptyFallback = EMPTY_ASSISTANT_RESPONSE): string {
    if (this.answerContent.trim()) {
      return this.answerContent;
    }
    if (this.thinking.trim()) {
      return this.thinking;
    }
    return emptyFallback;
  }
}
