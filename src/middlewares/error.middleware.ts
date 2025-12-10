import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

export function errorMiddleware(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const status = err.status || 500;
  logger.error("Unhandled error", err);
  res
    .status(status)
    .json({ success: false, message: err.message || "Internal Server Error" });
}
