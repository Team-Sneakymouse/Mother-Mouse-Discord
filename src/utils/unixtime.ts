import { Redis } from "ioredis";

export const SECS_IN_HOUR = 60 * 60;
export const SECS_IN_DAY = SECS_IN_HOUR * 24;
export const SECS_IN_WEEK = SECS_IN_DAY * 7;


var repeatingSchedule: { eventId: string, eventEpoch: number, secsBetweenEvents: number, executor: (scheduledTime: number) => void, lastEventUnix: number }[] = [];

var oneTimeScheduleExecutor: Map<string, (scheduledTime: number) => void> = new Map();
var oneTimeScheduleNextUnix: Map<string, number> = new Map();

export function Tick(redis: Redis) {//ought to be called after all events are scheduled
	/*
	We want to add secsBetweenEvents to the last_reset time and round it down so that it equals epoch + c*secsBetweenEvents for some int c.
	Given last_reset, epoch, there exists c such that
		epoch + (c - 1)*secsBetweenEvents <= last_reset < epoch + c*secsBetweenEvents.
	We want to figure out the value of epoch + c*secsBetweenEvents, so we want to find c.
	So (c - 1)*secsBetweenEvents <= last_reset - epoch
		==> c - 1 <= (last_reset - epoch)/secsBetweenEvents
		==> c <= (last_reset - epoch)/secsBetweenEvents + 1.
	and last_reset < epoch + c*secsBetweenEvents
		==> last_reset - epoch < c*secsBetweenEvents
		==> (last_reset - epoch)/secsBetweenEvents < c.
	Thus (last_reset - epoch)/secsBetweenEvents < c <= (last_reset - epoch)/secsBetweenEvents + 1.
	Given x a number, x < floor(x + 1) <= x + 1.
	Thus only int c that can satisfy the above property is 'floor((last_reset - epoch)/secsBetweenEvents + 1)'.
	So c = floor((last_reset - epoch)/secsBetweenEvents + 1)
		= floor((last_reset - epoch)/secsBetweenEvents) + 1
	*/
	let now_unix = Math.floor(Date.now()/1000);
	let sleepTime = SECS_IN_HOUR;
	//these functions cound be amoratize with a priority queue system
	//I find it unconvincing it will make a runtime difference at such low current usage
	for (let event of repeatingSchedule) {
		let { eventId, eventEpoch, secsBetweenEvents, executor, lastEventUnix } = event;

		let c = Math.floor((lastEventUnix - eventEpoch) / secsBetweenEvents) + 1;
		let nextEventUnix = eventEpoch + c * secsBetweenEvents;

		let eventSleepTime;
		if (nextEventUnix <= now_unix) {
			//time going backwards as it does in unix time (leap seconds) will not affect this code since it always takes the first greater and setting that to the last reset time
			event.lastEventUnix = now_unix;
			redis.hset("repeating-events-last-unix", eventId, now_unix);

			eventSleepTime = nextEventUnix - now_unix + secsBetweenEvents;

			//TODO: spawn these instead of executing them
			executor(nextEventUnix);
		} else {
			eventSleepTime = nextEventUnix - now_unix;
		}
		sleepTime = Math.min(sleepTime, eventSleepTime);
	}

	for (let [eventId, nextEventUnix] of oneTimeScheduleNextUnix) {
		if (nextEventUnix <= now_unix) {
			oneTimeScheduleNextUnix.delete(eventId);
			redis.hdel("one-time-events-next-unix", eventId);

			//NOTE: executing these instead of spawning them could cause recursion issues
			let exec = oneTimeScheduleExecutor.get(eventId);
			if (exec) exec(nextEventUnix);//should never fail
		} else {
			sleepTime = Math.min(sleepTime, nextEventUnix - now_unix);
		}
	}

	return sleepTime;
}


export async function ScheduleRepeating(redis: Redis, eventId: string, eventEpoch: number, secsBetweenEvents: number, executor: (scheduledTime: number) => void) {
	let ret = await redis.hget("repeating-events-last-unix", eventId);
	let lastEventUnix = ret ? parseInt(ret) : eventEpoch;//is parseInt good? if it fails events will be unscheduled or too frequently scheduled
	repeatingSchedule.push({
		eventId,
		eventEpoch,
		secsBetweenEvents,
		executor,
		lastEventUnix,
	});
}

export async function RegisterOneTimeEvent(redis: Redis, eventId: string, executor: (scheduledTime: number) => void) {
	let ret = await redis.hget("onetime-events-next-unix", eventId);

	if (ret) {
		oneTimeScheduleNextUnix.set(eventId, parseInt(ret));
	}
	oneTimeScheduleExecutor.set(eventId, executor);
}

export function ScheduleOnce(redis: Redis, eventId: string, whenUnix: number) {
	if (oneTimeScheduleExecutor.has(eventId)) {
		oneTimeScheduleNextUnix.set(eventId, whenUnix);
		redis.hset("one-time-events-next-unix", eventId, whenUnix);
	} else {
		throw new Error("unixtime: attempt to schedule unregistered event, please make sure the event is registered at process creation");//This is a developer's error, if ts was a smarter language it would even be possible to catch it statically.
	}
}
