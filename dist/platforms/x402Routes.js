"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeWallet = analyzeWallet;
exports.sweepReport = sweepReport;
exports.walletRoast = walletRoast;
exports.rugPullDetector = rugPullDetector;
exports.autoSweepPlanner = autoSweepPlanner;
exports.analyzeWalletGet = analyzeWalletGet;
exports.sweepReportGet = sweepReportGet;
exports.walletRoastGet = walletRoastGet;
exports.rugPullDetectorGet = rugPullDetectorGet;
exports.autoSweepPlannerGet = autoSweepPlannerGet;
exports.x402Health = x402Health;
const apiRoutes_1 = require("./apiRoutes");
// Payment is enforced by x402 middleware in `server.ts` (per PayAI docs).
async function analyzeWallet(req, res) {
    return (0, apiRoutes_1.analyzeWalletFree)(req, res);
}
async function sweepReport(req, res) {
    return (0, apiRoutes_1.sweepReportFree)(req, res);
}
async function walletRoast(req, res) {
    return (0, apiRoutes_1.walletRoastFree)(req, res);
}
async function rugPullDetector(req, res) {
    return (0, apiRoutes_1.rugPullDetectorFree)(req, res);
}
async function autoSweepPlanner(req, res) {
    return (0, apiRoutes_1.autoSweepPlannerFree)(req, res);
}
// GET handlers (kept for backwards compatibility; also protected).
async function analyzeWalletGet(req, res) {
    return (0, apiRoutes_1.analyzeWalletFree)(req, res);
}
async function sweepReportGet(req, res) {
    return (0, apiRoutes_1.sweepReportFree)(req, res);
}
async function walletRoastGet(req, res) {
    return (0, apiRoutes_1.walletRoastFree)(req, res);
}
async function rugPullDetectorGet(req, res) {
    return (0, apiRoutes_1.rugPullDetectorFree)(req, res);
}
async function autoSweepPlannerGet(req, res) {
    return (0, apiRoutes_1.autoSweepPlannerFree)(req, res);
}
async function x402Health(_req, res) {
    return res.json({ status: "ok", service: "arsweep-x402" });
}
