import express from "express";
import locationController from "../../controllers/location.controller";
import { validateRequest } from "../../middlewares/schema-validation.middleware";
import {
  gymParamsSchema,
  saveLocationSchema,
  searchNearbySchema,
} from "../../validators/location.validator";

const router = express.Router();

/**
 * @route POST /api/location/search
 * @desc Search for nearby gyms
 * @access Public
 */
router.post(
  "/search",
  validateRequest(searchNearbySchema),
  (req, res) => locationController.searchNearbyGyms(req, res)
);

/**
 * @route GET /api/location/gym/:id
 * @desc Get detailed information about a specific gym
 * @access Public
 */
router.get(
  "/gym/:id",
  validateRequest(gymParamsSchema),
  (req, res) => locationController.getGymDetails(req, res)
);

/**
 * @route POST /api/location/save
 * @desc Save user location
 * @access Public
 */
router.post(
  "/save",
  validateRequest(saveLocationSchema),
  (req, res) => locationController.saveUserLocation(req, res)
);

/**
 * @route GET /api/location/health
 * @desc Check location service health
 * @access Public
 */
router.get("/health", (req, res) => locationController.healthCheck(req, res));

export default router;
