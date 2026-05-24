import { EventEmitter } from 'events';

class TrajectoryEmitter extends EventEmitter {}

export const trajectoryEmitter = new TrajectoryEmitter();
