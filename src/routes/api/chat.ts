import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";

const SYSTEM_PROMPT = `You are Reelable, an AI video director and producer.
You help users plan and create videos: shorts, ads, music videos, dramas — up to 10 minutes.

You think in terms of:
- Scenes (with a prompt, duration, mood, camera direction)
- Characters and visual references
- Music, sound design, beats and pacing
- Storyboards and shot composition

When a user describes an idea, propose a concrete structure: scene-by-scene breakdown with
durations, suggested characters/references, and a music direction. Be specific, cinematic,
and concise. Use markdown headings and bullet lists. When iterating, refer to scenes by number.`;

type ChatRequestBody = { messages?: unknown };

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { messages } = (await request.json()) as ChatRequestBody;
        if (!Array.isArray(messages)) {
          return new Response("Messages are required", { status: 400 });
        }
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const gateway = createLovableAiGatewayProvider(key);
        const model = gateway("google/gemini-3-flash-preview");
        const result = streamText({
          model,
          system: SYSTEM_PROMPT,
          messages: await convertToModelMessages(messages as UIMessage[]),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages as UIMessage[],
        });
      },
    },
  },
});