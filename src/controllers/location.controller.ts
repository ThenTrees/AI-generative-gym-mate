import { Request, Response } from "express";
import locationService from "../services/location.service";
import { logger } from "../utils/logger";
import { sendError, sendSuccess } from "../utils/response";

export class LocationController {
  /**
   * @route POST /api/location/search
   * @desc Search for nearby gyms
   */
  async searchNearbyGyms(req: Request, res: Response): Promise<void> {
    try {
      const { latitude, longitude, radius = 10000, type = 'gym' } = req.body;

      // Validate required fields
      if (!latitude || !longitude) {
        res.status(400).json({
          success: false,
          message: 'Invalid request parameters',
          errors: ['Latitude and longitude are required']
        });
        return;
      }

      logger.info(`Searching for ${type} near ${latitude}, ${longitude} within ${radius}m`);

      const gyms = await locationService.searchNearbyGyms({
        latitude,
        longitude,
        radius,
        type
      });

      // Sort by distance
      gyms.sort((a, b) => a.distance - b.distance);

      sendSuccess(res, `Found ${gyms.length} gyms near your location`, {
        gyms,
        searchLocation: { latitude, longitude },
        radius: radius,
        type: type,
        count: gyms.length
      });

    } catch (error: any) {
      logger.error("Error in search gyms endpoint:", error);
      sendError(
        res,
        "Internal server error while searching for gyms",
        500,
        process.env.NODE_ENV === "development" ? error.message : "Something went wrong"
      );
    }
  }

  /**
   * @route GET /api/location/gym/:id
   * @desc Get detailed information about a specific gym
   */
  async getGymDetails(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({
          success: false,
          message: 'Gym ID is required'
        });
        return;
      }

      logger.info(`Getting details for gym: ${id}`);

      const details = await locationService.getPlaceDetails(id);
      
      if (!details || Object.keys(details).length === 0) {
        sendError(res, "Gym not found", 404);
        return;
      }

      sendSuccess(res, "Gym details retrieved successfully", details);

    } catch (error: any) {
      logger.error("Error in get gym details endpoint:", error);
      sendError(
        res,
        "Internal server error while getting gym details",
        500,
        process.env.NODE_ENV === "development" ? error.message : "Something went wrong"
      );
    }
  }

  /**
   * @route POST /api/location/save
   * @desc Save user location
   */
  async saveUserLocation(req: Request, res: Response): Promise<void> {
    try {
      const { latitude, longitude, address, timestamp } = req.body;

      if (!latitude || !longitude) {
        sendError(res, "Latitude and longitude are required", 400);
        return;
      }

      logger.info(`Saving user location: ${latitude}, ${longitude}`);

      const result = await locationService.saveUserLocation({
        latitude,
        longitude,
        address,
        timestamp: timestamp || new Date().toISOString()
      });

      sendSuccess(res, "Location saved successfully", result);

    } catch (error: any) {
      logger.error("Error in save location endpoint:", error);
      sendError(
        res,
        "Internal server error while saving location",
        500,
        process.env.NODE_ENV === "development" ? error.message : "Something went wrong"
      );
    }
  }

  /**
   * @route GET /api/location/health
   * @desc Check location service health
   */
  async healthCheck(req: Request, res: Response): Promise<void> {
    try {
      const hasApiKey = !!process.env.GEOAPIFY_API_KEY;
      
      sendSuccess(res, "Location service is healthy", {
        service: "location",
        status: "healthy",
        geoapifyApi: hasApiKey ? "configured" : "not_configured",
        apiProvider: "Geoapify Places API",
        timestamp: new Date().toISOString()
      });

    } catch (error: any) {
      logger.error("Error in location health check:", error);
      sendError(
        res,
        "Location service health check failed",
        500,
        process.env.NODE_ENV === "development" ? error.message : "Something went wrong"
      );
    }
  }
}

export default new LocationController();
