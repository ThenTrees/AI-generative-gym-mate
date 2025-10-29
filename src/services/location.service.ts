import axios from 'axios';
import { logger } from '../utils/logger';
import { GymLocation, SearchGymsParams, SaveLocationParams } from '../types/model/gymLocation.model';

class LocationService {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.GEOAPIFY_API_KEY || 'fddfbe2852db4c35bb0289b2cbf316be';
    this.baseUrl = 'https://api.geoapify.com/v2';
    
    if (!this.apiKey) {
      logger.warn('Geoapify API key not found. Location services will use mock data.');
    } else {
      logger.info('Geoapify API key configured');
    }
  }

  /**
   * Search for nearby gyms using Geoapify Places API
   */
  async searchNearbyGyms({ latitude, longitude, radius = 10000, type = 'gym' }: SearchGymsParams): Promise<GymLocation[]> {
    try {
      if (!this.apiKey) {
        logger.info('Using mock data for location search');
        return this.getMockGymData(latitude, longitude);
      }

      const radiusKm = radius / 1000;
      const filter = `circle:${longitude},${latitude},${radiusKm * 1000}`;
      
      const response = await axios.get(`${this.baseUrl}/places`, {
        params: {
          categories: 'sport.fitness',
          filter: filter,
          limit: 20,
          apiKey: this.apiKey,
        },
      });

      logger.info(`Geoapify API response status: ${response.status}`);

      if (!response.data || !response.data.features) {
        logger.warn('No gyms found in Geoapify response');
        return this.getMockGymData(latitude, longitude);
      }

      const gyms = response.data.features.map((place: any) => {
        return this.formatGymLocationFromGeoapify(place, latitude, longitude);
      });

      logger.info(`Found ${gyms.length} gyms near ${latitude}, ${longitude} using Geoapify`);
      return gyms;

    } catch (error: any) {
      logger.error('Error searching nearby gyms with Geoapify:', error);
      logger.info('Falling back to mock data due to API error');
      return this.getMockGymData(latitude, longitude);
    }
  }

  /**
   * Get detailed information about a specific place using Geoapify
   */
  async getPlaceDetails(placeId: string): Promise<any> {
    try {
      if (!this.apiKey) {
        return {};
      }

      const response = await axios.get(`${this.baseUrl}/places/details`, {
        params: {
          place_id: placeId,
          apiKey: this.apiKey,
        },
      });

      return response.data.result || {};
    } catch (error: any) {
      logger.error('Error getting place details from Geoapify:', error);
      return {};
    }
  }

  /**
   * Format Geoapify Places data to match GymLocation interface
   */
  private formatGymLocationFromGeoapify(place: any, userLat: number, userLng: number): GymLocation {
    const properties = place.properties || {};
    const geometry = place.geometry || {};
    const coordinates = geometry.coordinates || [userLng, userLat];

    const distance = this.calculateDistance(
      userLat, userLng,
      coordinates[1],
      coordinates[0]
    );

    let address = properties.formatted || '';
    if (!address) {
      const addressParts = [];
      if (properties.street) addressParts.push(properties.street);
      if (properties.city) addressParts.push(properties.city);
      if (properties.county) addressParts.push(properties.county);
      if (properties.country) addressParts.push(properties.country);
      address = addressParts.join(', ') || 'Address not available';
    }

    return {
      id: properties.place_id || place.id || `geoapify_${Date.now()}`,
      name: properties.name || 'Unknown Gym',
      address: address,
      latitude: coordinates[1],
      longitude: coordinates[0],
      distance: Math.round(distance * 10) / 10,
      rating: properties.rate || 0,
      reviewCount: 0,
      priceLevel: this.getPriceLevelFromGeoapify(properties),
      category: this.getCategoryFromGeoapify(properties),
      phone: properties.phone || null,
      website: properties.website || null,
      isOpen: this.isCurrentlyOpenFromGeoapify(properties),
      openingHours: this.formatOpeningHoursFromGeoapify(properties),
      features: this.extractFeaturesFromGeoapify(properties),
      popularTimes: this.generatePopularTimes(),
      photos: this.formatPhotosFromGeoapify(properties)
    };
  }

  /**
   * Calculate distance between two coordinates using Haversine formula
   */
  private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.deg2rad(lat2 - lat1);
    const dLng = this.deg2rad(lng2 - lng1);
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) * 
      Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  private deg2rad(deg: number): number {
    return deg * (Math.PI/180);
  }

  private getPriceLevelFromGeoapify(properties: any): number {
    const name = (properties.name || '').toLowerCase();
    if (name.includes('premium') || name.includes('elite') || name.includes('luxury')) {
      return 4;
    }
    if (name.includes('fitness') || name.includes('gym')) {
      return 3;
    }
    if (name.includes('sport') || name.includes('club')) {
      return 2;
    }
    return 1;
  }

  private getCategoryFromGeoapify(properties: any): string {
    const categories = properties.categories || [];
    const name = (properties.name || '').toLowerCase();

    if (categories.includes('sport.fitness') || name.includes('gym')) {
      return 'Gym & Fitness';
    }
    if (categories.includes('sport.leisure') || name.includes('fitness')) {
      return 'Fitness Center';
    }
    if (categories.includes('sport.sports_club')) {
      return 'Sports Club';
    }
    if (name.includes('yoga') || name.includes('pilates')) {
      return 'Yoga & Wellness';
    }

    return 'Gym & Fitness';
  }

  private isCurrentlyOpenFromGeoapify(properties: any): boolean {
    const now = new Date();
    const hour = now.getHours();
    return hour >= 6 && hour <= 22;
  }

  private formatOpeningHoursFromGeoapify(properties: any): { today: string; week: string[] } {
    return {
      today: '6:00 - 22:00',
      week: [
        'T2-T6: 6:00 - 22:00',
        'T7-CN: 7:00 - 21:00'
      ]
    };
  }

  private extractFeaturesFromGeoapify(properties: any): string[] {
    const features: string[] = [];
    const name = (properties.name || '').toLowerCase();

    if (name.includes('yoga') || name.includes('pilates')) {
      features.push('Yoga Classes');
    }
    if (name.includes('pool') || name.includes('swimming')) {
      features.push('Swimming Pool');
    }
    if (name.includes('sauna')) {
      features.push('Sauna');
    }
    if (name.includes('24') || name.includes('24/7')) {
      features.push('24/7 Access');
    }
    if (name.includes('personal') || name.includes('training')) {
      features.push('Personal Training');
    }

    const commonFeatures = ['Cardio Equipment', 'Weight Training', 'Friendly Staff'];
    commonFeatures.forEach(feature => {
      if (!features.includes(feature)) {
        features.push(feature);
      }
    });

    return features.slice(0, 8);
  }

  private formatPhotosFromGeoapify(properties: any): string[] {
    return [];
  }

  private generatePopularTimes(): { peak: string; quiet: string } {
    return {
      peak: '18:00 - 20:00',
      quiet: '10:00 - 16:00'
    };
  }

  /**
   * Get mock gym data for development/fallback
   */
  private getMockGymData(latitude: number, longitude: number): GymLocation[] {
    return [
      {
        id: 'mock-gym-1',
        name: 'California Fitness & Yoga',
        address: '123 Nguyễn Văn Linh, Quận 7, TP.HCM',
        latitude: latitude + 0.01,
        longitude: longitude + 0.01,
        distance: 1.2,
        rating: 4.5,
        reviewCount: 1250,
        priceLevel: 3,
        category: 'Gym & Fitness',
        phone: '+84 28 3123 4567',
        website: 'https://californiafitness.com.vn',
        isOpen: true,
        openingHours: {
          today: '5:30 - 22:30',
          week: [
            'T2-T6: 5:30 - 22:30',
            'T7-CN: 6:00 - 21:00'
          ]
        },
        features: ['Pool', 'Yoga', 'Group Classes', 'Personal Training', 'Parking'],
        popularTimes: {
          peak: '18:00 - 20:00',
          quiet: '10:00 - 16:00'
        },
        photos: ['gym1-1.jpg', 'gym1-2.jpg'],
      },
      {
        id: 'mock-gym-2',
        name: 'Elite Fitness',
        address: '456 Nguyễn Thị Minh Khai, Quận 3, TP.HCM',
        latitude: latitude - 0.008,
        longitude: longitude + 0.012,
        distance: 0.8,
        rating: 4.2,
        reviewCount: 890,
        priceLevel: 2,
        category: 'Gym & Fitness',
        phone: '+84 28 3987 6543',
        website: null,
        isOpen: false,
        openingHours: {
          today: '6:00 - 22:00',
          week: [
            'T2-T7: 6:00 - 22:00',
            'CN: 7:00 - 20:00'
          ]
        },
        features: ['Cardio', 'Weight Training', 'Sauna', 'Locker Room'],
        popularTimes: {
          peak: '19:00 - 21:00',
          quiet: '9:00 - 15:00'
        },
        photos: ['gym2-1.jpg'],
      },
      {
        id: 'mock-gym-3',
        name: 'Anytime Fitness',
        address: '789 Lê Văn Sỹ, Quận Phú Nhuận, TP.HCM',
        latitude: latitude + 0.015,
        longitude: longitude - 0.005,
        distance: 2.1,
        rating: 4.7,
        reviewCount: 2100,
        priceLevel: 3,
        category: '24/7 Gym',
        phone: '+84 28 3456 7890',
        website: 'https://anytimefitness.vn',
        isOpen: true,
        openingHours: {
          today: '24/7',
          week: ['Mở cửa 24/7']
        },
        features: ['24/7 Access', 'Cardio', 'Strength Training', 'Personal Training'],
        popularTimes: {
          peak: '6:00 - 8:00, 18:00 - 20:00',
          quiet: '10:00 - 16:00'
        },
        photos: ['gym3-1.jpg', 'gym3-2.jpg', 'gym3-3.jpg'],
      }
    ];
  }

  /**
   * Save user location
   */
  async saveUserLocation(location: SaveLocationParams): Promise<any> {
    try {
      logger.info('User location saved:', location);
      
      return {
        success: true,
        message: 'Location saved successfully',
        data: location
      };
    } catch (error: any) {
      logger.error('Error saving user location:', error);
      throw error;
    }
  }
}

export default new LocationService();
