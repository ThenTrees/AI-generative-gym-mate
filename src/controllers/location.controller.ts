import { Request, Response } from 'express';
import locationService from '../services/location.service';
import { logger } from '../utils/logger';

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

      res.json({
        success: true,
        data: gyms,
        message: `Found ${gyms.length} gyms near your location`,
        meta: {
          searchLocation: { latitude, longitude },
          radius: radius,
          type: type,
          count: gyms.length
        }
      });

    } catch (error: any) {
      logger.error('Error in search gyms endpoint:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error while searching for gyms',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
      });
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
        res.status(404).json({
          success: false,
          message: 'Gym not found'
        });
        return;
      }

      res.json({
        success: true,
        data: details,
        message: 'Gym details retrieved successfully'
      });

    } catch (error: any) {
      logger.error('Error in get gym details endpoint:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error while getting gym details',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
      });
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
        res.status(400).json({
          success: false,
          message: 'Invalid request parameters',
          errors: ['Latitude and longitude are required']
        });
        return;
      }

      logger.info(`Saving user location: ${latitude}, ${longitude}`);

      const result = await locationService.saveUserLocation({
        latitude,
        longitude,
        address,
        timestamp: timestamp || new Date().toISOString()
      });

      res.json({
        success: true,
        data: result,
        message: 'Location saved successfully'
      });

    } catch (error: any) {
      logger.error('Error in save location endpoint:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error while saving location',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
      });
    }
  }

  /**
   * @route GET /api/location/health
   * @desc Check location service health
   */
  async healthCheck(req: Request, res: Response): Promise<void> {
    try {
      const hasApiKey = !!process.env.GEOAPIFY_API_KEY;
      
      res.json({
        success: true,
        data: {
          service: 'location',
          status: 'healthy',
          geoapifyApi: hasApiKey ? 'configured' : 'not_configured',
          apiProvider: 'Geoapify Places API',
          timestamp: new Date().toISOString()
        },
        message: 'Location service is healthy'
      });

    } catch (error: any) {
      logger.error('Error in location health check:', error);
      res.status(500).json({
        success: false,
        message: 'Location service health check failed',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
      });
    }
  }
}

export default new LocationController();
