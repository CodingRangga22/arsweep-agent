import type { Request, Response } from "express";
import {
  analyzeWalletFree,
  sweepReportFree,
  walletRoastFree,
  rugPullDetectorFree,
  autoSweepPlannerFree,
} from "./apiRoutes";

// Payment is enforced by x402 middleware in `server.ts` (per PayAI docs).
export async function analyzeWallet(req: Request, res: Response) {
  return analyzeWalletFree(req, res);
}
export async function sweepReport(req: Request, res: Response) {
  return sweepReportFree(req, res);
}
export async function walletRoast(req: Request, res: Response) {
  return walletRoastFree(req, res);
}
export async function rugPullDetector(req: Request, res: Response) {
  return rugPullDetectorFree(req, res);
}
export async function autoSweepPlanner(req: Request, res: Response) {
  return autoSweepPlannerFree(req, res);
}

// GET handlers (kept for backwards compatibility; also protected).
export async function analyzeWalletGet(req: Request, res: Response) {
  return analyzeWalletFree(req, res);
}
export async function sweepReportGet(req: Request, res: Response) {
  return sweepReportFree(req, res);
}
export async function walletRoastGet(req: Request, res: Response) {
  return walletRoastFree(req, res);
}
export async function rugPullDetectorGet(req: Request, res: Response) {
  return rugPullDetectorFree(req, res);
}
export async function autoSweepPlannerGet(req: Request, res: Response) {
  return autoSweepPlannerFree(req, res);
}

export async function x402Health(_req: Request, res: Response) {
  return res.json({ status: "ok", service: "arsweep-x402" });
}
