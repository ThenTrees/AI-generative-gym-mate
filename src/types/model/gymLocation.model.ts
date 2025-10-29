export interface GymLocation {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  distance: number;
  rating: number;
  reviewCount: number;
  priceLevel: number;
  category: string;
  phone: string | null;
  website: string | null;
  isOpen: boolean;
  openingHours: {
    today: string;
    week: string[];
  };
  features: string[];
  popularTimes: {
    peak: string;
    quiet: string;
  };
  photos: string[];
}

export interface SearchGymsParams {
  latitude: number;
  longitude: number;
  radius?: number;
  type?: string;
}

export interface SaveLocationParams {
  latitude: number;
  longitude: number;
  address?: string;
  timestamp?: string;
}
