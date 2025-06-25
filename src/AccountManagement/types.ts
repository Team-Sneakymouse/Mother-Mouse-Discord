import { RecordModel } from "pocketbase";

export type UserRecord = RecordModel & {
	name: string;
	discord_id: string;
	twitch: {
		id?: string;
		display_name?: string;
		profile_image_url?: string;
		token?: {
			access_token: string;
			refresh_token: string;
			expires_at: number;
			scope: string[];
		};
	} | null;
};
export type AccountRecord = RecordModel & {
	name: string;
	owner: string;
	main: boolean;
	expand: {
		owner: {
			discord_id: string;
		};
	};
};
export type LinkRecord = RecordModel & {
	user: string;
	account: string;
	link_token: string;
};
