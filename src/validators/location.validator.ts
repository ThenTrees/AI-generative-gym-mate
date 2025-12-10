import { z } from "zod";

export const searchNearbySchema = {
  body: z.object({
    latitude: z.number({ invalid_type_error: "latitude must be a number" }),
    longitude: z.number({ invalid_type_error: "longitude must be a number" }),
    radius: z.number().optional(),
    type: z.string().optional(),
  }),
};

export const saveLocationSchema = {
  body: z.object({
    latitude: z.number({ invalid_type_error: "latitude must be a number" }),
    longitude: z.number({ invalid_type_error: "longitude must be a number" }),
    address: z.string().optional(),
    timestamp: z.string().optional(),
  }),
};

export const gymParamsSchema = {
  params: z.object({
    id: z.string().min(1, "id is required"),
  }),
};

