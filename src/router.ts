import { runAgent } from "./agent/core";

export interface RouterInput {
  platform: "telegram" | "web" | "api";
  userId: string;
  message: string;
  walletAddress?: string;
}

export async function handleMessage(input: RouterInput) {
  console.log(`[Router] ${input.platform} | user:${input.userId} | "${input.message.slice(0, 60)}"`);
  const result = await runAgent(`${input.platform}:${input.userId}`, input.message, input.walletAddress);
  return { ...result, platform: input.platform, userId: input.userId };
}
