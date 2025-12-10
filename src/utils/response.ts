import { Response } from "express";

type SuccessPayload<T> = {
  success: true;
  message: string;
  data?: T;
};

type ErrorPayload = {
  success: false;
  message: string;
  error?: string;
};

export const sendSuccess = <T>(
  res: Response,
  message: string,
  data?: T,
  status = 200
) => {
  const payload: SuccessPayload<T> = { success: true, message, data };
  return res.status(status).json(payload);
};

export const sendError = (
  res: Response,
  message: string,
  status = 400,
  error?: string
) => {
  const payload: ErrorPayload = { success: false, message, error };
  return res.status(status).json(payload);
};

