/**
 * Loopback test server implementing the subset of the pinned
 * external-openapi-v1 contract the client uses: create conversation, process
 * message, list messages — authenticated by the Agent-Secret-Key header.
 * Shipped as a testing utility (like the mock management provider) so
 * downstream integrations can contract-test live evaluation without cost.
 */
import { createServer, type Server } from "node:http";

export interface MockConversationServerOptions {
  secretKey: string;
  /** message → deterministic assistant reply. */
  reply?: (message: string) => string;
}

export interface StartedConversationServer {
  baseUrl: string;
  close: () => Promise<void>;
  requests: Array<{ method: string; path: string; headers: Record<string, unknown> }>;
}

export function startMockConversationServer(
  options: MockConversationServerOptions,
): Promise<StartedConversationServer> {
  const reply = options.reply ?? ((message: string) => `echo: ${message}`);
  const conversations = new Map<string, Array<Record<string, unknown>>>();
  let conversationCounter = 0;
  let messageCounter = 0;
  const requests: StartedConversationServer["requests"] = [];

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const url = new URL(request.url ?? "/", "http://localhost");
      requests.push({
        method: request.method ?? "GET",
        path: url.pathname,
        headers: { ...request.headers },
      });
      const send = (status: number, body: unknown): void => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      };
      if (request.headers["agent-secret-key"] !== options.secretKey) {
        send(403, { name: {}, message: "Invalid API key or secret key." });
        return;
      }
      const body =
        chunks.length > 0
          ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>)
          : {};

      if (request.method === "POST" && url.pathname === "/external/conversations") {
        if (typeof body["conversationUserId"] !== "string") {
          send(400, { message: "conversationUserId is required" });
          return;
        }
        const id = `conv_${(conversationCounter += 1)}`;
        conversations.set(id, []);
        send(201, { id, conversationUserId: body["conversationUserId"] });
        return;
      }
      const messageMatch = /^\/external\/conversations\/([^/]+)\/messages$/.exec(url.pathname);
      if (request.method === "POST" && messageMatch !== null) {
        const conversation = conversations.get(messageMatch[1]!);
        if (conversation === undefined) {
          send(404, { message: "not found" });
          return;
        }
        const question = String(body["message"] ?? "");
        const answer = reply(question);
        const createdAt = "2026-07-28T00:00:00.000Z";
        const questionId = `msg_${(messageCounter += 1)}`;
        const answerId = `msg_${(messageCounter += 1)}`;
        conversation.push(
          {
            id: questionId,
            message: question,
            conversationId: messageMatch[1]!,
            senderRole: "conversation_user",
            conversationMessageId: questionId,
            source: "api",
            createdAt,
            isAnonymized: false,
          },
          {
            id: answerId,
            message: answer,
            conversationId: messageMatch[1]!,
            senderRole: "assistant",
            conversationMessageId: questionId,
            source: "api",
            createdAt,
            isAnonymized: false,
          },
        );
        send(201, {
          id: answerId,
          message: answer,
          conversationId: messageMatch[1]!,
          senderRole: "assistant",
          conversationMessageId: questionId,
          source: "api",
          createdAt,
          isAnonymized: false,
        });
        return;
      }
      if (request.method === "GET" && messageMatch !== null) {
        const conversation = conversations.get(messageMatch[1]!);
        if (conversation === undefined) {
          send(404, { message: "not found" });
          return;
        }
        send(200, { messages: conversation });
        return;
      }
      send(404, { message: "not found" });
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("no port"));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        requests,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => (error ? rejectClose(error) : resolveClose()));
          }),
      });
    });
  });
}
