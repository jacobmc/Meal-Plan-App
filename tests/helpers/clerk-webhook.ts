import { vi } from "vitest";
import type { WebhookEvent } from "@clerk/backend/webhooks";

let nextEvent: WebhookEvent | null = null;
let nextError: Error | null = null;

export function setMockWebhookEvent(evt: WebhookEvent | null) {
  nextEvent = evt;
  nextError = null;
}

export function setMockWebhookError(err: Error) {
  nextEvent = null;
  nextError = err;
}

vi.mock("@clerk/nextjs/webhooks", () => ({
  verifyWebhook: async (): Promise<WebhookEvent> => {
    if (nextError) throw nextError;
    if (!nextEvent) {
      throw new Error("test setup: setMockWebhookEvent was not called");
    }
    return nextEvent;
  },
}));
