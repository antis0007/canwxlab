import { describe, it, expect } from 'vitest';
import {
  parseWmsTimeDimension,
  nearestTime,
  isTimeInRange,
  resolveWmsTimeForTimeline,
  formatWmsUtcSecond,
} from './wmsTime';

describe('wmsTime utilities', () => {
  it('parseWmsTimeDimension - comma separated', () => {
    const extent = '2024-01-01T00:00:00Z, 2024-01-01T01:00:00Z';
    const times = parseWmsTimeDimension(extent);
    expect(times).toHaveLength(2);
    expect(times[0]).toBe(new Date('2024-01-01T00:00:00Z').getTime());
    expect(times[1]).toBe(new Date('2024-01-01T01:00:00Z').getTime());
  });

  it('parseWmsTimeDimension - interval', () => {
    const extent = '2024-01-01T00:00:00Z/2024-01-01T03:00:00Z/PT1H';
    const times = parseWmsTimeDimension(extent);
    expect(times).toHaveLength(4); // 00, 01, 02, 03
  });

  it('nearestTime', () => {
    const times = [1000, 2000, 3000];
    expect(nearestTime(1400, times)).toBe(1000);
    expect(nearestTime(1600, times)).toBe(2000);
    expect(nearestTime(4000, times)).toBe(3000);
  });

  it('isTimeInRange', () => {
    const times = [1000, 2000, 3000];
    expect(isTimeInRange(1500, times)).toBe(true);
    expect(isTimeInRange(500, times)).toBe(false);
    expect(isTimeInRange(3500, times)).toBe(false);
  });

  it('resolveWmsTimeForTimeline - global', () => {
    const times = [1000, 2000, 3000];
    const resolved = resolveWmsTimeForTimeline(1600, times, 'global');
    expect(resolved).toBe(formatWmsUtcSecond(2000));
  });

  it('resolveWmsTimeForTimeline - latest', () => {
    const times = [1000, 2000, 3000];
    const resolved = resolveWmsTimeForTimeline(1600, times, 'latest');
    expect(resolved).toBe(formatWmsUtcSecond(3000));
  });

  it('resolveWmsTimeForTimeline - fixed', () => {
    const times = [1000, 2000, 3000];
    const resolved = resolveWmsTimeForTimeline(1600, times, 'fixed', 1000);
    expect(resolved).toBe(formatWmsUtcSecond(1000));
  });

  it('formats WMS TIME without milliseconds for GeoMet', () => {
    const times = parseWmsTimeDimension('2026-05-16T00:00:00Z/2026-05-16T06:00:00Z/PT3H');
    expect(resolveWmsTimeForTimeline(Date.parse('2026-05-16T05:59:59.999Z'), times, 'global'))
      .toBe('2026-05-16T06:00:00Z');
    expect(formatWmsUtcSecond(Date.parse('2026-05-16T06:00:00.000Z')))
      .toBe('2026-05-16T06:00:00Z');
  });
});
