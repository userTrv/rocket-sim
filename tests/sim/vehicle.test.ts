import { describe, expect, it } from 'vitest';
import { G0, SEA_LEVEL_PRESSURE } from '../../src/sim/constants';
import { rk4Step } from '../../src/sim/dynamics';
import { length, vec3 } from '../../src/sim/math/vec3';
import { FALCON_9 } from '../../src/sim/vehicle/falcon9';
import { Vehicle } from '../../src/sim/vehicle/vehicle';

const s1 = FALCON_9.stages[0]!;
const s2 = FALCON_9.stages[1]!;

describe('vehicle propulsion', () => {
  it('derives mass flow from vacuum thrust and Isp (mdot = F / (Isp g0))', () => {
    const v = new Vehicle(FALCON_9);
    v.ignite();
    const out = v.propulsion(1, 0);
    expect(out.massFlow).toBeCloseTo(s1.engine.vacuumThrust / (s1.engine.ispVacuum * G0), 6);
    expect(out.thrust).toBeCloseTo(s1.engine.vacuumThrust, 3);
  });

  it('loses thrust at sea level so the effective Isp equals the sea-level Isp', () => {
    const v = new Vehicle(FALCON_9);
    v.ignite();
    const out = v.propulsion(1, SEA_LEVEL_PRESSURE);
    expect(out.thrust / (out.massFlow * G0)).toBeCloseTo(s1.engine.ispSeaLevel, 6);
    expect(out.thrust / 1000).toBeCloseTo(7_460, -1); // ~7.5 MN, close to the quoted 7.6 MN
  });

  it('honours the minimum throttle and treats 0 as shutdown', () => {
    const v = new Vehicle(FALCON_9);
    v.ignite();
    expect(v.propulsion(0.1, 0).throttle).toBe(s1.engine.minThrottle);
    expect(v.propulsion(0, 0).thrust).toBe(0);
    expect(v.effectiveThrottle(0.7)).toBe(0.7);
  });

  it('produces nothing until ignited and consumes ignitions', () => {
    const v = new Vehicle(FALCON_9);
    expect(v.propulsion(1, 0).thrust).toBe(0);
    for (let i = 0; i < s1.engine.ignitions; i++) {
      expect(v.ignite()).toBe(true);
      v.shutdown();
    }
    expect(v.stageIgnitionsLeft).toBe(0);
    expect(v.ignite()).toBe(false);
  });

  it('burns the stage dry in the expected time', () => {
    const v = new Vehicle(FALCON_9);
    v.ignite();
    const mdot = v.propulsion(1, 0).massFlow;
    let t = 0;
    while (v.stagePropellant > 0) {
      v.consume(mdot * 0.1);
      t += 0.1;
    }
    expect(t).toBeCloseTo(s1.propellantMass / mdot, 0);
  });

  it('reproduces the Tsiolkovsky rocket equation when integrated far from gravity', () => {
    const v = new Vehicle(FALCON_9);
    v.stageIndex = 1; // upper stage alone
    v.ignite();
    const m0 = v.mass;
    const { thrust, massFlow } = v.propulsion(1, 0);
    const burnTime = s2.propellantMass / massFlow;
    let state = { r: vec3(1e13, 0, 0), v: vec3(0, 0, 0), m: m0 };
    const dt = 0.5;
    const steps = Math.floor(burnTime / dt);
    for (let i = 0; i < steps; i++) state = rk4Step(state, { thrust: vec3(0, thrust, 0), massFlow, referenceArea: 0 }, dt);
    const expected = s2.engine.ispVacuum * G0 * Math.log(m0 / state.m);
    expect(length(state.v) / expected).toBeCloseTo(1, 6);
  });
});

describe('vehicle mass properties and staging', () => {
  it('sums the full stack at liftoff', () => {
    const v = new Vehicle(FALCON_9);
    const expected =
      s1.dryMass + s1.propellantMass + s2.dryMass + s2.propellantMass + FALCON_9.payloadMass + FALCON_9.fairing.mass;
    expect(v.mass).toBe(expected);
    const props = v.massProperties();
    expect(props.comHeight).toBeGreaterThan(0);
    expect(props.comHeight).toBeLessThan(props.length / 2); // bottom-heavy with propellant
    expect(props.pitchInertia).toBeGreaterThan(props.rollInertia);
  });

  it('drops the spent stage and activates the next one with its engine off', () => {
    const v = new Vehicle(FALCON_9);
    v.ignite();
    const before = v.mass;
    const body = v.separateStage();
    expect(body?.kind).toBe('stage');
    expect(body?.mass).toBe(s1.dryMass + s1.propellantMass);
    expect(v.mass).toBeCloseTo(before - body!.mass, 6);
    expect(v.stageIndex).toBe(1);
    expect(v.engineRunning).toBe(false);
    expect(v.hasNextStage).toBe(false);
    expect(v.separateStage()).toBeNull();
  });

  it('jettisons the fairing once', () => {
    const v = new Vehicle(FALCON_9);
    const before = v.mass;
    expect(v.jettisonFairing()?.mass).toBe(FALCON_9.fairing.mass);
    expect(v.mass).toBe(before - FALCON_9.fairing.mass);
    expect(v.jettisonFairing()).toBeNull();
  });

  it('gains gimbal authority with thrust', () => {
    const v = new Vehicle(FALCON_9);
    const props = v.massProperties();
    const coasting = v.maxTorque(0, props);
    const burning = v.maxTorque(7e6, props);
    expect(coasting.x).toBe(s1.rcsTorque);
    expect(burning.x).toBeGreaterThan(coasting.x * 100);
  });
});
