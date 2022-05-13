import { Client, ColorResolvable, Role, Snowflake, Util } from "discord.js";

var changeBackTimeout: NodeJS.Timeout;

const colors: {
	[key: string]: { role: Snowflake; primary: ColorResolvable; secondary: ColorResolvable; timeout?: NodeJS.Timeout };
} = {
	"90956966947467264": { role: "971480462897848330", primary: "#FF26A4", secondary: "#0FB5E5" }, // rawb
	"140876176833904640": { role: "971532452436799579", primary: "#C439FF", secondary: "#23BEB2" }, // megan
	"684022579450740789": { role: "971532491821314149", primary: "#F8B0F6", secondary: "#FF7D40" }, // msdvil
	"486400092035743744": { role: "971532674520985670", primary: "#FAE21C", secondary: "#EB4343" }, // nora
	"232942838646571009": { role: "971532629448986674", primary: "#FAFAFA", secondary: "#1D1D1D" }, // muzi
	"690452097564672020": { role: "971532980063469659", primary: "#3D7F7F", secondary: "#C439FF" }, // dorky
	"133430614861938688": { role: "974790236473278554", primary: "#AAABAC", secondary: "#C10002" }, // sandy
	"181935746465136641": { role: "971532339672907806", primary: "#1F8B4C", secondary: "#FAE21C" }, // citra
	"138345057072840704": { role: "971532383515983953", primary: "#0FB5E5", secondary: "#FAE21C" }, // dani
	"96249508786098176": { role: "971532153303228557", primary: "#992D22", secondary: "#FF7D40" }, // boom
	"115970165669232644": { role: "971532231157878866", primary: "#C10002", secondary: "#C439FF" }, // carize
	"232244542122754048": { role: "971532423479300156", primary: "#FF7D40", secondary: "#EE8D20" }, // grumm
	"108296164599734272": { role: "974790357369880586", primary: "#73C977", secondary: "#2A8947" }, // momo
	"829761750643376138": { role: "974791308797444166", primary: "#96FBF6", secondary: "#F7AAFF" }, // hype
	"251454850309554186": { role: "971532733836824628", primary: "#B3E98C", secondary: "#C093DF" }, // bear
};

export default function RawbColor(client: Client) {
	client.on("messageCreate", async (message) => {
		if (!message.guild) return;
		if (message.guildId === "391355330241757205") {
			// rawb.tv
			if (message.author.id !== "90956966947467264") return;

			const digitalBardRole = message.guild.roles.resolve("413105777885052969");
			if (!digitalBardRole) return console.log("Digital Bard role is missing!");

			await digitalBardRole.setColor(digitalBardRole.hexColor.toUpperCase() == "#0FB5E5" ? "#FF26A4" : "#0FB5E5");

			if (changeBackTimeout) clearTimeout(changeBackTimeout);
			changeBackTimeout = setTimeout(() => digitalBardRole.setColor("#0FB5E5"), 5000);
		} else if (message.guildId === "971479608664924202") {
			// ooc
			if (!Object.keys(colors).includes(message.author.id)) return;
			const color = colors[message.author.id as keyof typeof colors];

			const role = message.guild.roles.cache.find((r) => r.id === color.role) as Role;
			await role.setColor(role.hexColor.toUpperCase() == color.primary ? color.secondary : color.primary);

			if (color.timeout) clearTimeout(color.timeout);
			color.timeout = setTimeout(() => role.setColor(color.primary), 5000);
		}
	});
}
