import { describe, expect, it } from 'vitest';

import {
  realisticSeedBridges,
  realisticSeedChains,
} from '../src/database/test-data/realisticSeedData.js';

describe('realistic seed data', () => {
  it('contains 200 unique, bounded, non-stress events', () => {
    const events = realisticSeedChains.flatMap((chain) => chain.events);
    const names = events.map(([name]) => name);

    expect(realisticSeedChains).toHaveLength(40);
    expect(events).toHaveLength(200);
    expect(new Set(names).size).toBe(200);
    expect(events.every(([name, alias]) => name.length <= 50 && alias.length <= 80)).toBe(true);
    expect(events.every(([name, alias]) => !name.includes('SIM-') && !alias.includes('SIM-'))).toBe(
      true,
    );
  });

  it('keeps every relation direction unique and references known events', () => {
    const names = new Set(
      realisticSeedChains.flatMap((chain) => chain.events.map(([name]) => name)),
    );
    const directions = realisticSeedChains.flatMap((chain) =>
      chain.events.slice(0, -1).map(([cause], index) => `${cause}→${chain.events[index + 1]![0]}`),
    );
    directions.push(...realisticSeedBridges.map((bridge) => `${bridge.cause}→${bridge.effect}`));

    expect(realisticSeedBridges).toHaveLength(20);
    expect(directions).toHaveLength(180);
    expect(new Set(directions).size).toBe(180);
    expect(
      realisticSeedBridges.every(
        (bridge) =>
          names.has(bridge.cause) &&
          names.has(bridge.effect) &&
          bridge.cause !== bridge.effect &&
          bridge.confidence >= 20,
      ),
    ).toBe(true);
  });
});
