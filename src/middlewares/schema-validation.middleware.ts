import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";
import { sendError } from "../utils/response";

type Schemas = {
  body?: ZodSchema<any>;
  query?: ZodSchema<any>;
  params?: ZodSchema<any>;
};

export const validateRequest =
  (schemas: Schemas) => (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schemas.body) {
        const parsed = schemas.body.safeParse(req.body);
        if (!parsed.success) {
          const message = parsed.error.errors.map((e) => e.message).join(", ");
          return sendError(res, message, 400);
        }
        req.body = parsed.data;
      }

      if (schemas.query) {
        const parsed = schemas.query.safeParse(req.query);
        if (!parsed.success) {
          const message = parsed.error.errors.map((e) => e.message).join(", ");
          return sendError(res, message, 400);
        }
        req.query = parsed.data;
      }

      if (schemas.params) {
        const parsed = schemas.params.safeParse(req.params);
        if (!parsed.success) {
          const message = parsed.error.errors.map((e) => e.message).join(", ");
          return sendError(res, message, 400);
        }
        req.params = parsed.data;
      }

      return next();
    } catch (err: any) {
      return sendError(res, "Invalid request", 400, err?.message);
    }
  };

