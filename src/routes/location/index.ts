import express from 'express';
import locationController from '../../controllers/location.controller';

const router = express.Router();

/**
 * @route POST /api/location/search
 * @desc Search for nearby gyms
 * @access Public
 */
router.post('/search', (req, res) => locationController.searchNearbyGyms(req, res));

/**
 * @route GET /api/location/gym/:id
 * @desc Get detailed information about a specific gym
 * @access Public
 */
router.get('/gym/:id', (req, res) => locationController.getGymDetails(req, res));

/**
 * @route POST /api/location/save
 * @desc Save user location
 * @access Public
 */
router.post('/save', (req, res) => locationController.saveUserLocation(req, res));

/**
 * @route GET /api/location/health
 * @desc Check location service health
 * @access Public
 */
router.get('/health', (req, res) => locationController.healthCheck(req, res));

export default router;
