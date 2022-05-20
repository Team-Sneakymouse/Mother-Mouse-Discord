export enum Projects {
	TILII = "768372809616850964",
	TEST = "155020885521203200",
}

export const projectIds: { [key in Projects]: number } = {
	[Projects.TILII]: 21931946,
	[Projects.TEST]: 34231544,
};

export const channelIds: { [key in Projects]: string } = {
	[Projects.TILII]: "768375421854810162",
	[Projects.TEST]: "916742177994997770",
};

export const webhooks: { [key in Projects]: [string, string] } = {
	[Projects.TILII]: ["950147121556906105", "3Ap3gyQh46qvewLX0terNb8LHtH0LD8IQKFhRtBPW2qAFeqtNY-863RwtjuDMIoLYOrs"],
	[Projects.TEST]: ["949638659768991754", "Yp9GZ5pKMEml8Pb7qgpTQM9AfcJ0CgXw72bNWgFp2f32aPbmKawiye5zF6YIQSrsfRjX"],
};
