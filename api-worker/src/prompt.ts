import type { ChatMessage } from "./types";

export function wrapUserMessage(content: string): string {
  const safe = content.split("</user_message>").join("< /user_message>");
  return `<user_message>\n${safe}\n</user_message>`;
}

export function buildMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) =>
    m.role === "user" ? { role: "user", content: wrapUserMessage(m.content) } : m,
  );
}
