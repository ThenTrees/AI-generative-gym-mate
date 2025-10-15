import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

export function errorMiddleware(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const status = err.status || 500;
  logger.error(err, "Unhandled error");
  res.status(status).json({ error: err.message || "Internal Server Error" });
}
