// Remove the import since Ride is declared globally in type.d.ts

export const sortRides = (rides: Ride[]): Ride[] => {
  const result = rides.sort((a, b) => {
    const dateA = new Date(`${a.created_at}T${a.ride_time}`);
    const dateB = new Date(`${b.created_at}T${b.ride_time}`);
    return dateB.getTime() - dateA.getTime();
  });

  return result.reverse();
};

export function formatTime(minutes: number): string {
  const formattedMinutes = +minutes?.toFixed(0) || 0;

  if (formattedMinutes < 60) {
    return `${minutes} min`;
  } else {
    const hours = Math.floor(formattedMinutes / 60);
    const remainingMinutes = formattedMinutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const day = date.getDate();
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();

  return `${day < 10 ? "0" + day : day} ${month} ${year}`;
}

export const formatUserName = (
  user: any, 
  format: 'full' | 'first' | 'initials' = 'full'
): string => {
  if (!user) return '';
  
  const firstName = user.first_name || user.firstName || user.name?.split(' ')[0] || '';
  const lastName = user.last_name || user.lastName || user.name?.split(' ').slice(1).join(' ') || '';

  switch (format) {
    case 'first':
      return firstName;
    case 'initials':
      const firstInitial = firstName.charAt(0).toUpperCase();
      const lastInitial = lastName.charAt(0).toUpperCase();
      return firstInitial + lastInitial || firstInitial || '?';
    case 'full':
    default:
      return lastName ? `${firstName} ${lastName}` : firstName || user.name || '';
  }
};

export const getUserInitials = (
  firstName?: string, 
  lastName?: string, 
  fullName?: string
): string => {
  if (firstName && lastName) {
    return firstName.charAt(0).toUpperCase() + lastName.charAt(0).toUpperCase();
  }
  if (firstName) {
    return firstName.charAt(0).toUpperCase();
  }
  if (fullName) {
    const nameParts = fullName.trim().split(' ');
    if (nameParts.length >= 2) {
      return nameParts[0].charAt(0).toUpperCase() + nameParts[nameParts.length - 1].charAt(0).toUpperCase();
    }
    return nameParts[0].charAt(0).toUpperCase();
  }
  return '?';
};

/**
 * Formats an address to display user-friendly place names instead of raw addresses
 * Examples:
 * "737 Albany Shaker Rd, Albany, NY 12211, USA" -> "Albany International Airport"
 * "New Haven, CT 06520, USA" -> "Yale University"
 * "Pittsfield Station" -> "Joseph Scelsi International Transportation Center"
 */
export const formatDisplayAddress = (address: string): string => {
  if (!address) return address;

  // Comprehensive place mappings for exact addresses
  const exactAddressMap: Record<string, string> = {
    // Albany International Airport variants
    '737 Albany Shaker Rd, Albany, NY 12211, USA': 'Albany International Airport',
    '737 Albany Shaker Road, Albany, NY 12211, USA': 'Albany International Airport',
    'Albany-Shaker Road, Albany, NY, USA': 'Albany International Airport',
    'Albany Airport, Albany, NY, USA': 'Albany International Airport',
    
    // Williams College variants  
    '880 Main St, Williamstown, MA 01267, USA': 'Williams College',
    'Williams College, Williamstown, MA 01267, USA': 'Williams College',
    'Main Street, Williamstown, MA, USA': 'Williams College',
    
    // Yale University variants
    'New Haven, CT 06520, USA': 'Yale University',
    'New Haven, CT 06511, USA': 'Yale University',
    'New Haven, CT 06510, USA': 'Yale University',
    'Yale University, New Haven, CT, USA': 'Yale University',
    'Yale Campus, New Haven, CT, USA': 'Yale University',
    
    // Transportation Centers
    'Pittsfield Station': 'Joseph Scelsi International Transportation Center',
    'Pittsfield Station, Pittsfield, MA, USA': 'Joseph Scelsi International Transportation Center',
    'Joseph Scelsi International Transportation Center': 'Joseph Scelsi International Transportation Center',
    
    // Other major universities and colleges by ZIP codes
    'Cambridge, MA 02138, USA': 'Harvard University',
    'Cambridge, MA 02139, USA': 'MIT',
    'Amherst, MA 01002, USA': 'Amherst College',
    'Middlebury, VT 05753, USA': 'Middlebury College',
    'Hanover, NH 03755, USA': 'Dartmouth College',
    'Burlington, VT 05405, USA': 'University of Vermont',
    
    // Major cities (fallback for general areas)
    'Albany, NY, USA': 'Albany',
    'Williamstown, MA, USA': 'Williamstown',
    'Boston, MA, USA': 'Boston',
    'New York, NY, USA': 'New York City',
  };

  // Check exact mapping first
  if (exactAddressMap[address]) {
    return exactAddressMap[address];
  }

  // ZIP code to institution mapping for major universities
  const zipCodeMap: Record<string, string> = {
    // Connecticut
    '06520': 'Yale University',
    '06511': 'Yale University', 
    '06510': 'Yale University',
    '06519': 'Southern Connecticut State University',
    
    // Massachusetts
    '02138': 'Harvard University',
    '02139': 'Massachusetts Institute of Technology',
    '01002': 'Amherst College',
    '01267': 'Williams College',
    '01060': 'Smith College',
    '01075': 'Mount Holyoke College',
    
    // Vermont
    '05753': 'Middlebury College',
    '05405': 'University of Vermont',
    
    // New Hampshire  
    '03755': 'Dartmouth College',
    
    // New York
    '12211': 'Albany International Airport Area',
    '12206': 'Albany Medical Center',
  };

  // Extract ZIP code and check mapping
  const zipMatch = address.match(/\b(\d{5})\b/);
  if (zipMatch) {
    const zip = zipMatch[1];
    if (zipCodeMap[zip]) {
      return zipCodeMap[zip];
    }
  }

  // Enhanced pattern matching for specific place types
  const universityPatterns = [
    /Yale University/i,
    /Harvard University/i,
    /Williams College/i,
    /MIT|Massachusetts Institute of Technology/i,
    /Amherst College/i,
    /Smith College/i,
    /Mount Holyoke College/i,
    /Middlebury College/i,
    /Dartmouth College/i,
    /University of Vermont/i,
    /Albany Medical Center/i,
  ];

  for (const pattern of universityPatterns) {
    if (pattern.test(address)) {
      const match = address.match(pattern);
      if (match) {
        return match[0];
      }
    }
  }

  // Transportation center patterns
  const transportationPatterns = [
    { pattern: /Albany.*Airport/i, name: 'Albany International Airport' },
    { pattern: /Bradley.*Airport/i, name: 'Bradley International Airport' },
    { pattern: /Logan.*Airport/i, name: 'Logan International Airport' },
    { pattern: /Penn Station/i, name: 'Penn Station' },
    { pattern: /Grand Central/i, name: 'Grand Central Terminal' },
  ];

  for (const transport of transportationPatterns) {
    if (transport.pattern.test(address)) {
      return transport.name;
    }
  }

  // Hospital and medical center patterns
  const medicalPatterns = [
    { pattern: /Albany Medical Center/i, name: 'Albany Medical Center' },
    { pattern: /Massachusetts General/i, name: 'Massachusetts General Hospital' },
    { pattern: /Brigham.*Women/i, name: 'Brigham and Women\'s Hospital' },
    { pattern: /Yale.*Hospital/i, name: 'Yale New Haven Hospital' },
  ];

  for (const medical of medicalPatterns) {
    if (medical.pattern.test(address)) {
      return medical.name;
    }
  }

  // Shopping and commercial areas
  const commercialPatterns = [
    { pattern: /Crossgates Mall/i, name: 'Crossgates Mall' },
    { pattern: /Legacy Place/i, name: 'Legacy Place' },
    { pattern: /Copley Place/i, name: 'Copley Place' },
  ];

  for (const commercial of commercialPatterns) {
    if (commercial.pattern.test(address)) {
      return commercial.name;
    }
  }

  // Extract place names from structured addresses
  // Pattern: "Institution Name, City, State ZIP, Country"
  const structuredMatch = address.match(/^([^,]+(?:University|College|Institute|Academy|School|Hospital|Medical|Center|Mall|Airport|Station|Terminal)[^,]*),\s*[^,]+,\s*[A-Z]{2}/i);
  if (structuredMatch) {
    return structuredMatch[1].trim();
  }

  // Extract business/landmark names (non-numeric starting, with landmark keywords)
  const landmarkKeywords = ['University', 'College', 'Institute', 'Academy', 'School', 'Hospital', 'Medical', 'Center', 'Mall', 'Airport', 'Station', 'Terminal', 'Library', 'Museum', 'Theater', 'Stadium', 'Arena', 'Park'];
  const landmarkPattern = new RegExp(`^([A-Za-z][^,]*(?:${landmarkKeywords.join('|')})[^,]*)(?:,|$)`, 'i');
  const landmarkMatch = address.match(landmarkPattern);
  if (landmarkMatch) {
    return landmarkMatch[1].trim();
  }

  // Try to extract establishment names that don't start with numbers
  const establishmentMatch = address.match(/^([A-Za-z][^,0-9]+?)(?:\s*,|\s+\d)/);
  if (establishmentMatch && establishmentMatch[1].length > 3) {
    const name = establishmentMatch[1].trim();
    // Only return if it looks like a proper name (not just a street name)
    if (!/^(North|South|East|West|Main|First|Second|Third|Fourth|Fifth|State|Park|Oak|Elm|Maple)\s/i.test(name)) {
      return name;
    }
  }

  // For well-known cities, extract city and state
  const wellKnownCities = ['Boston', 'New York', 'Cambridge', 'New Haven', 'Hartford', 'Springfield', 'Worcester', 'Albany', 'Burlington', 'Montpelier', 'Hanover', 'Manchester', 'Providence'];
  for (const city of wellKnownCities) {
    if (address.includes(city)) {
      const cityMatch = address.match(new RegExp(`(${city}(?:,\\s*[A-Z]{2})?)`, 'i'));
      if (cityMatch) {
        return cityMatch[1];
      }
    }
  }

  // Last resort: extract just city and state
  const cityStateMatch = address.match(/([^,]+,\s*[A-Z]{2})/);
  if (cityStateMatch) {
    return cityStateMatch[1].trim();
  }

  // Return original address if no better option found
  return address;
};

/**
 * Splits an address into a display-friendly format for ride cards
 * Returns { placeName: string, locationDetails: string }
 * Examples:
 * "737 Albany Shaker Rd, Albany, NY 12211, USA" -> { placeName: "Albany International Airport", locationDetails: "Albany, NY" }
 * "Yale University, New Haven, CT, USA" -> { placeName: "Yale University", locationDetails: "New Haven, CT" }
 */
export const formatAddressForCard = (address: string): { placeName: string; locationDetails: string } => {
  if (!address) return { placeName: address, locationDetails: '' };

  // First get the formatted display address (place name)
  const placeName = formatDisplayAddress(address);
  
  // If we got a nice place name, extract city/state for location details
  if (placeName !== address) {
    // Extract city and state from original address
    const cityStateMatch = address.match(/([^,]+,\s*[A-Z]{2})/);
    if (cityStateMatch) {
      return {
        placeName,
        locationDetails: cityStateMatch[1].trim()
      };
    }
    
    // Try to extract just city name if no state
    const cityMatch = address.match(/,\s*([^,]+),/);
    if (cityMatch) {
      return {
        placeName,
        locationDetails: cityMatch[1].trim()
      };
    }
  }
  
  // If we didn't get a better place name, try to extract meaningful parts
  // For addresses like "123 Street Name, City, State"
  const addressParts = address.split(',').map(part => part.trim());
  
  if (addressParts.length >= 2) {
    // Check if first part looks like a street address (starts with number)
    if (/^\d/.test(addressParts[0])) {
      // Street address format: show last meaningful parts as place name
      if (addressParts.length >= 3) {
        return {
          placeName: addressParts[0], // Street address
          locationDetails: `${addressParts[1]}, ${addressParts[2].replace(/ \d{5}.*/, '')}` // City, State (remove ZIP)
        };
      } else {
        return {
          placeName: addressParts[0],
          locationDetails: addressParts[1]
        };
      }
    } else {
      // Non-street address format
      if (addressParts.length >= 3) {
        return {
          placeName: addressParts[0], // Place name
          locationDetails: `${addressParts[1]}, ${addressParts[2].replace(/ \d{5}.*/, '')}` // City, State
        };
      } else {
        return {
          placeName: addressParts[0],
          locationDetails: addressParts[1]
        };
      }
    }
  }
  
  // Fallback: return original address as place name
  return {
    placeName: address,
    locationDetails: ''
  };
};

