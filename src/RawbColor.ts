import { Client, ColorResolvable, Role, Snowflake } from "discord.js";

var changeBackTimeout: NodeJS.Timeout;

const colors: {
	[key: string]: { role: Snowflake; primary: ColorResolvable; secondary: ColorResolvable; timeout?: NodeJS.Timeout };
} = {
	"968649137635614793": { role: "971480462897848330", primary: 0xff26a4, secondary: 0xff0000 }, // rawb
	"140876176833904640": { role: "971532452436799579", primary: 0xc439ff, secondary: 0x23beb2 }, // megan
	"684022579450740789": { role: "971532491821314149", primary: 0xf8b0f6, secondary: 0xff7d40 }, // msdvil
	"486400092035743744": { role: "971532674520985670", primary: 0xfae21c, secondary: 0xeb4343 }, // nora
	"232942838646571009": { role: "971532629448986674", primary: 0xfafafa, secondary: 0x1d1d1d }, // muzi
	"690452097564672020": { role: "971532980063469659", primary: 0x3d7f7f, secondary: 0xc439ff }, // dorky
	"133430614861938688": { role: "974790236473278554", primary: 0xaaabac, secondary: 0xc10002 }, // sandy
	"181935746465136641": { role: "971532339672907806", primary: 0x1f8b4c, secondary: 0xfae21c }, // citra
	"138345057072840704": { role: "971532383515983953", primary: 0x0fb5e5, secondary: 0xfae21c }, // dani
	"96249508786098176": { role: "971532153303228557", primary: 0x992d22, secondary: 0xff7d40 }, // boom
	"115970165669232644": { role: "971532231157878866", primary: 0xc10002, secondary: 0xc439ff }, // carize
	"232244542122754048": { role: "971532423479300156", primary: 0xff7d40, secondary: 0xee8d20 }, // grumm
	"108296164599734272": { role: "974790357369880586", primary: 0x73c977, secondary: 0x2a8947 }, // momo
	"829761750643376138": { role: "974791308797444166", primary: 0x96fbf6, secondary: 0xf7aaff }, // hype
	"251454850309554186": { role: "971532733836824628", primary: 0xb3e98c, secondary: 0xc093df }, // bear
	"375836440027987968": { role: "974867809932824656", primary: 0xffd59e, secondary: 0x604e98 }, //lady
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
			changeBackTimeout = setTimeout(() => digitalBardRole.setColor("#0FB5E5"), message.content.length * 100);
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
