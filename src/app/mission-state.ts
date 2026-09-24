import type { SimEventType } from '../sim/events';

/** High-level mission state machine: pad -> ascent -> orbit, with crash as a terminal state. */
export type MissionState = 'pad' | 'ascent' | 'orbit' | 'crashed';

export function nextMissionState(state: MissionState, event: SimEventType): MissionState {
  if (state === 'crashed') return state;
  if (event === 'crash') return 'crashed';
  switch (state) {
    case 'pad':
      return event === 'liftoff' ? 'ascent' : state;
    case 'ascent':
      return event === 'orbit' ? 'orbit' : state;
    case 'orbit':
      return state;
  }
}

export const MISSION_STATE_LABEL: Record<MissionState, string> = {
  pad: 'On pad',
  ascent: 'Ascent',
  orbit: 'In orbit',
  crashed: 'Vehicle lost',
};

/** Whether entering this state should show the mission result screen. */
export const isResultState = (state: MissionState): boolean => state === 'orbit' || state === 'crashed';
