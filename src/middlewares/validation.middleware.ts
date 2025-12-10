import { rateLimit } from "express-rate-limit";
import { Request, Response, NextFunction } from "express";
import { loadConfig } from "../configs/environment";

const config = loadConfig();

export const rateLimiter = rateLimit({
  windowMs: config.api.rateLimit.windowMs,
  max: config.api.rateLimit.max,
  message: {
    success: false,
    error: "Too Many Requests",
    message: "Rate limit exceeded. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const validateContentType = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (req.method === "POST" || req.method === "PUT") {
    if (!req.is("application/json")) {
      res.status(400).json({
        success: false,
        error: "Invalid Content-Type",
        message: "Content-Type must be application/json",
      });
      return;
    }
  }
  next();
};
