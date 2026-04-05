"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleMessage = handleMessage;
const core_1 = require("./agent/core");
async function handleMessage(input) {
    console.log(`[Router] ${input.platform} | user:${input.userId} | "${input.message.slice(0, 60)}"`);
    const result = await (0, core_1.runAgent)(`${input.platform}:${input.userId}`, input.message, input.walletAddress);
    return { ...result, platform: input.platform, userId: input.userId };
}
