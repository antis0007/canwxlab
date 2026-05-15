export interface SampledWeatherPoint {
  temperatureC: number;
  precipitationRate: number;
  windU: number;
  windV: number;
  windSpeed: number;
  cloudOpacity: number;
}

export function sampleMockWeatherPoint(longitude: number, latitude: number, frame: number): SampledWeatherPoint {
  const phase = frame / 30;
  const waveA = Math.sin((longitude + latitude) / 12 + phase);
  const waveB = Math.cos(latitude / 9 - phase * 0.7);

  const temperatureC = 14 - Math.abs(latitude - 52) * 0.45 + waveA * 4.2 + waveB * 1.9;
  const precipitationRate = Math.max(0, (Math.sin(longitude / 8 + phase * 1.4) + 1) * 3.4 + waveB * 0.8);

  const windU = Math.cos((latitude + frame * 0.45) / 10) * 7.5;
  const windV = Math.sin((longitude - frame * 0.35) / 11) * 5.3;
  const windSpeed = Math.hypot(windU, windV);

  const cloudOpacity = Math.max(0, Math.min(1, (waveA * 0.35 + waveB * 0.25 + 0.5)));

  return {
    temperatureC,
    precipitationRate,
    windU,
    windV,
    windSpeed,
    cloudOpacity,
  };
}

export function createTemperatureGrid(frame: number): GeoJSON.FeatureCollection {
  const cells: GeoJSON.Feature[] = [];
  const lonStart = -141;
  const lonStep = 5.6;
  const latStart = 40;
  const latStep = 3.8;

  for (let y = 0; y < 11; y += 1) {
    for (let x = 0; x < 18; x += 1) {
      const west = lonStart + x * lonStep;
      const south = latStart + y * latStep;
      const centerLon = west + lonStep * 0.5;
      const centerLat = south + latStep * 0.5;
      const sample = sampleMockWeatherPoint(centerLon, centerLat, frame);
      cells.push({
        type: "Feature",
        properties: {
          temperature: sample.temperatureC,
        },
        geometry: {
          type: "Polygon",
          coordinates: [[
            [west, south],
            [west + lonStep, south],
            [west + lonStep, south + latStep],
            [west, south + latStep],
            [west, south],
          ]],
        },
      });
    }
  }

  return {
    type: "FeatureCollection",
    features: cells,
  };
}

export function createRadarBlobs(frame: number): GeoJSON.FeatureCollection {
  const centers = [
    { lon: -113.4, lat: 53.6, base: 8.4 },
    { lon: -97.2, lat: 49.8, base: 6.1 },
    { lon: -79.8, lat: 44.3, base: 7.2 },
    { lon: -63.7, lat: 46.1, base: 5.4 },
  ];

  const features: GeoJSON.Feature[] = [];
  const drift = frame / 45;

  centers.forEach((center, index) => {
    for (let ring = 0; ring < 5; ring += 1) {
      const radiusLon = 1.1 + ring * 0.6;
      const radiusLat = 0.8 + ring * 0.44;
      const lon = center.lon + Math.sin(drift + index) * 0.6;
      const lat = center.lat + Math.cos(drift * 0.8 + index * 0.7) * 0.45;
      const intensity = Math.max(0.2, center.base - ring * 1.35 + Math.sin(drift * 1.7 + index) * 1.1);

      features.push({
        type: "Feature",
        properties: { precip: intensity },
        geometry: {
          type: "Polygon",
          coordinates: [[
            [lon - radiusLon, lat - radiusLat],
            [lon + radiusLon, lat - radiusLat * 0.7],
            [lon + radiusLon * 0.7, lat + radiusLat],
            [lon - radiusLon * 0.85, lat + radiusLat * 0.75],
            [lon - radiusLon, lat - radiusLat],
          ]],
        },
      });
    }
  });

  return { type: "FeatureCollection", features };
}

export interface WindParticle {
  path: [number, number][];
  speed: number;
}

export function createWindParticles(frame: number, density: number, windScale: number): WindParticle[] {
  const stepLon = Math.max(4, 12 - density / 450);
  const stepLat = Math.max(4, 9 - density / 620);
  const particles: WindParticle[] = [];

  for (let lon = -136; lon <= -56; lon += stepLon) {
    for (let lat = 42; lat <= 72; lat += stepLat) {
      const sample = sampleMockWeatherPoint(lon, lat, frame);
      const dx = (sample.windU / 10) * windScale;
      const dy = (sample.windV / 10) * windScale;
      particles.push({
        path: [
          [lon, lat],
          [lon + dx, lat + dy],
        ],
        speed: sample.windSpeed,
      });
    }
  }

  return particles;
}

export function createCloudOverlay(frame: number): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const lonStart = -140;
  const lonStep = 6.2;
  const latStart = 40;
  const latStep = 4.4;

  for (let y = 0; y < 9; y += 1) {
    for (let x = 0; x < 15; x += 1) {
      const west = lonStart + x * lonStep;
      const south = latStart + y * latStep;
      const centerLon = west + lonStep * 0.5;
      const centerLat = south + latStep * 0.5;
      const cloudOpacity = sampleMockWeatherPoint(centerLon, centerLat, frame).cloudOpacity;
      features.push({
        type: "Feature",
        properties: { cloudOpacity },
        geometry: {
          type: "Polygon",
          coordinates: [[
            [west, south],
            [west + lonStep, south],
            [west + lonStep, south + latStep],
            [west, south + latStep],
            [west, south],
          ]],
        },
      });
    }
  }

  return { type: "FeatureCollection", features };
}
