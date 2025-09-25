import { Response } from "express";
import { StatusCodes } from "../../utils/statusCodes";
import { ReasonPhrases } from "../../utils/reasonPhrases";

interface SuccessResponseParams {
  message?: string;
  statusCode?: number;
  reasonStatusCode?: string;
  metadata?: Record<string, any>;
}

export default class SuccessResponse {
  public message: string;
  public status: number;
  public metadata: Record<string, any>;

  constructor({
    message,
    statusCode = StatusCodes.OK,
    reasonStatusCode = ReasonPhrases.OK,
    metadata = {},
  }: SuccessResponseParams) {
    this.message = !message ? reasonStatusCode : message;
    this.status = statusCode;
    this.metadata = metadata;
  }

  send(res: Response, headers: Record<string, string> = {}): Response {
    // Set headers if provided
    Object.keys(headers).forEach((key) => {
      res.setHeader(key, headers[key]);
    });

    return res.status(this.status).json({
      message: this.message,
      status: this.status,
      metadata: this.metadata,
    });
  }
}

class OK extends SuccessResponse {
  constructor({
    message,
    metadata,
  }: {
    message?: string;
    metadata?: Record<string, any>;
  }) {
    super({ message, metadata });
  }
}

// Example usage:
// new OK({ message: "Operation successful", metadata: { data: result } }).send(res);
