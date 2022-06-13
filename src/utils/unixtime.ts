import Redis from "ioredis";

export const SECS_IN_HOUR = 60 * 60;
export const SECS_IN_DAY = SECS_IN_HOUR * 24;
export const SECS_IN_WEEK = SECS_IN_DAY * 7;


var schedule: { eventId: string, eventEpoch: number, secsBetweenEvents: number, executor: () => {} }[] = [];

export function Tick() {
	let now_unix = Date.now()/1000;
	//check unix timestamp and do reset if enough time has passed
	let last_reset_unix = server_state.last_reset_otherwise_server_genisis_unix;
	/*
	We want to add a day to the last_reset time and round it down so that it equals SM_RESET_EPOCH%SECS_IN_DAY + c*SECS_IN_DAY for some int c.
	Given last_reset, SM_RESET_EPOCH, there exists c such that
		SM_RESET_EPOCH%SECS_IN_DAY + (c - 1)*SECS_IN_DAY last_reset <= last_reset < SM_RESET_EPOCH%SECS_IN_DAY + c*SECS_IN_DAY.
	We want to figure out the value of SM_RESET_EPOCH%SECS_IN_DAY + c*SECS_IN_DAY, so we want to find c.
	So (c - 1)*SECS_IN_DAY <= last_reset - SM_RESET_EPOCH%SECS_IN_DAY
		==> c - 1 <= (last_reset - SM_RESET_EPOCH%SECS_IN_DAY)/SECS_IN_DAY
		==> c <= (last_reset - SM_RESET_EPOCH%SECS_IN_DAY)/SECS_IN_DAY + 1.
	and last_reset < SM_RESET_EPOCH%SECS_IN_DAY + c*SECS_IN_DAY
		==> last_reset - SM_RESET_EPOCH%SECS_IN_DAY < c*SECS_IN_DAY
		==> (last_reset - SM_RESET_EPOCH%SECS_IN_DAY)/SECS_IN_DAY < c.
	Thus (last_reset - SM_RESET_EPOCH%SECS_IN_DAY)/SECS_IN_DAY < c <= (last_reset - SM_RESET_EPOCH%SECS_IN_DAY)/SECS_IN_DAY + 1.
	Given a, a < floor(a + 1) <= a + 1.
	Thus only int c that can satisfy the above property is 'floor((last_reset - SM_RESET_EPOCH%SECS_IN_DAY)/SECS_IN_DAY + 1)'.
	So c = floor((last_reset - SM_RESET_EPOCH%SECS_IN_DAY)/SECS_IN_DAY + 1)
			= floor((last_reset - SM_RESET_EPOCH%SECS_IN_DAY)/SECS_IN_DAY) + 1
			= (last_reset - SM_RESET_EPOCH%SECS_IN_DAY) '/' SECS_IN_DAY + 1 (where '/' is integer division)
	*/
	let c = (last_reset_unix - SM_RESET_EPOCH_UNIX % SECS_IN_DAY_UNIX) / SECS_IN_DAY_UNIX + 1;
	let next_reset_unix = SM_RESET_EPOCH_UNIX % SECS_IN_DAY_UNIX + c * SECS_IN_DAY_UNIX;

	if (next_reset_unix <= now_unix) {
		//time going backwards as it does in unix time (leap seconds) will not affect this code since it always takes the first greater and setting that to the last reset time
		server_state.last_reset_otherwise_server_genisis_unix = now_unix;
		//do reset

	}
}


export function ScheduleRepeating(redis: Redis.Redis, eventId: string, eventEpoch: number, secsBetweenEvents: number, executor: () => {}) {
	schedule.push({
		eventId,
		eventEpoch,
		secsBetweenEvents,
		executor,
	})
	redis.hset("repeating-events", eventId, );

}
