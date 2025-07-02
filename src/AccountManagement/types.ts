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
export type AccountRecord<T extends RecordModel | undefined = undefined> = RecordModel & {
	name: string;
	owner: string;
	main: boolean;
	dvz: boolean;
	expand?: T extends UserRecord ? { owner: UserRecord } : undefined;
};
export type LinkRecord<T extends RecordModel | undefined = undefined> = RecordModel & {
	user: string;
	account: string;
	link_token: string;
	expand?: T extends UserRecord ? { user: UserRecord } : T extends AccountRecord ? { account: AccountRecord } : undefined;
};

export type ButtonIds = {
	ACCOUNT_MANAGEMENT: string;
	ACCOUNT_MINECRAFT_SELECT: string;
	TWITCH_REMOVE: string;
	TWITCH_ADD: string;
	MINECRAFT_SETMAIN: string;
	MINECRAFT_REMOVE: string;
	MINECRAFT_ADD: string;
	MINECRAFT_LINK_MODAL: string;
	MINECRAFT_LINK_SUBMIT: string;
};
